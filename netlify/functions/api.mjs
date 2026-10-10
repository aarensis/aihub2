import crypto from 'node:crypto';

const providers = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', env: 'OPENAI_API_KEY' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', env: 'GROQ_API_KEY' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', env: 'OPENROUTER_API_KEY' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env: 'GEMINI_API_KEY' },
  cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', env: 'CEREBRAS_API_KEY' }
};

// Netlify synchronous functions accept request bodies up to ~6 MB. Images are compressed in the browser
// before upload, so this leaves headroom for a few images plus text.
const MAX_BODY_CHARS = 5500000;
const MAX_IMAGES_TOTAL = 8;
const MAX_IMAGE_URL_CHARS = 2500000;

const response = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  body: JSON.stringify(data)
});

const validPart = p => p && typeof p === 'object' && (
  (p.type === 'text' && typeof p.text === 'string' && p.text.length < 100000) ||
  (p.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.length < MAX_IMAGE_URL_CHARS &&
    /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(p.image_url.url.slice(0, 40)))
);
const validContent = c => (typeof c === 'string' && c.length < 100000) ||
  (Array.isArray(c) && c.length > 0 && c.length <= 10 && c.every(validPart));
const countImages = messages => messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url').length : 0), 0);
const textLength = messages => messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : m.content.reduce((k, p) => k + (p.text?.length || 0), 0)), 0);

// OpenRouter's free roster changes constantly, so read it live (public endpoint, no key needed) and cache for an hour.
let freeCache = { t: 0, list: [] };
async function openrouterFreeModels() {
  if (freeCache.list.length && Date.now() - freeCache.t < 3600e3) return freeCache.list;
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('OpenRouter model list unavailable (' + r.status + ')');
  const d = await r.json();
  const list = (d.data || [])
    .filter(m => {
      const pr = m.pricing || {};
      const free = pr.prompt != null && pr.completion != null && Number(pr.prompt) === 0 && Number(pr.completion) === 0;
      const out = m.architecture?.output_modalities;
      return free && (!out || out.includes('text')) && !/embed|safety|guard|moderation/i.test(m.id);
    })
    .map(m => ({ id: m.id, name: m.name || m.id, vision: !!m.architecture?.input_modalities?.includes('image'), context: m.context_length || null }))
    .sort((a, b) => (a.id === 'openrouter/free' ? -1 : b.id === 'openrouter/free' ? 1 : a.id.localeCompare(b.id)));
  freeCache = { t: Date.now(), list };
  return list;
}

// ---- Per-user API keys -------------------------------------------------------------------------
// Keys are encrypted (AES-256-GCM) with KEY_ENCRYPTION_SECRET, which only exists in Netlify. The ciphertext is bound
// to the user id + provider, so a row copied to another user/provider will not decrypt. The browser can save or
// delete a key but is never sent it back.
const PROVIDER_LABELS = { openai: 'OpenAI', groq: 'Groq', openrouter: 'OpenRouter', gemini: 'Google Gemini', cerebras: 'Cerebras' };
const encKey = () => { const s = process.env.KEY_ENCRYPTION_SECRET; return s && s.length >= 16 ? crypto.createHash('sha256').update(s).digest() : null; };
export function encrypt(plain, aad) {
  const k = encKey(); if (!k) throw new Error('KEY_ENCRYPTION_SECRET is not configured in Netlify (needs 16+ characters).');
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64')).join('.');
}
export function decrypt(blob, aad) {
  const k = encKey(); if (!k) throw new Error('KEY_ENCRYPTION_SECRET is not configured in Netlify.');
  const [iv, tag, ct] = String(blob).split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv); d.setAAD(Buffer.from(aad)); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
const rest = (jwt, path, opts = {}) => fetch(process.env.SUPABASE_URL + '/rest/v1/' + path, {
  ...opts, headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(6000)
});
async function userKey(jwt, userId, provider) {
  const r = await rest(jwt, `user_api_keys?select=key_enc&provider=eq.${provider}&limit=1`);
  if (!r.ok) throw new Error('Could not read your saved keys. Run the updated supabase.sql in Supabase.');
  const row = (await r.json())[0]; if (!row) return null;
  try { return decrypt(row.key_enc, userId + ':' + provider); }
  catch { throw new Error('Your saved ' + PROVIDER_LABELS[provider] + ' key could not be decrypted (KEY_ENCRYPTION_SECRET changed?). Re-enter it in Settings.'); }
}

// Record usage in Supabase under the signed-in user's own session (row-level security applies),
// so the totals are shared by every device that logs in as this user.
async function logUsage(jwt, row) {
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/token_usage', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(4000)
    });
    return r.ok;
  } catch { return false; }
}

export async function handler(event) {
  const action = event.path.split('/').pop();
  if (action === 'config' && event.httpMethod === 'GET') {
    return response(200, {
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      adminUsername: process.env.ADMIN_USERNAME || 'admin',
      adminEmail: process.env.ADMIN_EMAIL || ''
    });
  }
  if (!['providers', 'chat', 'models', 'keys'].includes(action)) return response(404, { error: 'Not found' });
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /i, '');
  if (!jwt) return response(401, { error: 'Sign in required' });
  try {
    const auth = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + jwt } });
    if (!auth.ok) return response(401, { error: 'Invalid session' });
    const user = await auth.json();
    if (!user.id) return response(401, { error: 'Invalid session' });
    // Any account you created in Supabase may sign in. Only the admin may fall back to the Netlify-level keys.
    const isAdmin = !!process.env.ADMIN_EMAIL && user.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

    if (action === 'providers') {
      const r = await rest(jwt, 'user_api_keys?select=provider,last4');
      const mine = r.ok ? Object.fromEntries((await r.json()).map(x => [x.provider, x.last4])) : {};
      return response(200, {
        email: user.email, isAdmin, encryptionReady: !!encKey(), tableReady: r.ok,
        providers: Object.fromEntries(Object.entries(providers).map(([k, v]) => [k, mine[k] !== undefined ? { configured: true, source: 'user', last4: mine[k] } : isAdmin && process.env[v.env] ? { configured: true, source: 'server' } : { configured: false }]))
      });
    }

    if (action === 'keys') {
      if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
      const { provider, key, remove } = JSON.parse(event.body || '{}');
      if (!Object.hasOwn(providers, provider)) return response(400, { error: 'Unknown provider' });
      if (remove) {
        const r = await rest(jwt, `user_api_keys?user_id=eq.${user.id}&provider=eq.${provider}`, { method: 'DELETE' });
        return r.ok ? response(200, { ok: true }) : response(500, { error: 'Could not remove the key. Run the updated supabase.sql in Supabase.' });
      }
      const k = typeof key === 'string' ? key.trim() : '';
      if (k.length < 8 || k.length > 600 || /\s/.test(k)) return response(400, { error: 'That does not look like an API key (no spaces, at least 8 characters).' });
      const key_enc = encrypt(k, user.id + ':' + provider);
      const r = await rest(jwt, 'user_api_keys?on_conflict=user_id,provider', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: user.id, provider, key_enc, last4: k.slice(-4), updated_at: new Date().toISOString() })
      });
      return r.ok ? response(200, { ok: true, last4: k.slice(-4) }) : response(500, { error: 'Could not save the key. Run the updated supabase.sql in Supabase.' });
    }

    if (action === 'models') {
      const provider = event.queryStringParameters?.provider;
      if (provider !== 'openrouter') return response(400, { error: 'Live model lists are only available for OpenRouter' });
      return response(200, { models: await openrouterFreeModels() });
    }

    if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
    if ((event.body || '').length > MAX_BODY_CHARS) return response(413, { error: 'Request too large. Remove an image or attach fewer files.' });
    const { provider, model, messages } = JSON.parse(event.body || '{}');
    if (!Object.hasOwn(providers, provider) || typeof model !== 'string' || model.length > 180 || !model.trim() || !Array.isArray(messages) || messages.length > 150 ||
      !messages.every(m => m && ['user', 'assistant', 'system'].includes(m.role) && validContent(m.content)) || countImages(messages) > MAX_IMAGES_TOTAL) {
      return response(400, { error: 'Invalid request' });
    }
    const p = providers[provider];
    let key = await userKey(jwt, user.id, provider);
    if (!key && isAdmin) key = process.env[p.env];
    if (!key) return response(400, { error: 'Add your ' + PROVIDER_LABELS[provider] + ' API key in Settings → API keys to use this provider.' });

    const r = await fetch(p.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(provider === 'openrouter' ? { 'X-Title': 'AI Hub' } : {}) },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(22000)
    });
    const data = await r.json();
    if (!r.ok) return response(r.status, { error: data.error?.message || data[0]?.error?.message || JSON.stringify(data).slice(0, 500) });

    const content = data.choices?.[0]?.message?.content || '';
    // Use provider-reported usage; if a provider omits it, fall back to a rough estimate and flag it as such.
    let input = Number(data.usage?.prompt_tokens ?? data.usage?.input_tokens) || 0;
    let output = Number(data.usage?.completion_tokens ?? data.usage?.output_tokens) || 0;
    let total = Number(data.usage?.total_tokens) || input + output;
    let estimated = false;
    if (!total) {
      estimated = true;
      input = Math.ceil(textLength(messages) / 4) + countImages(messages) * 800;
      output = Math.ceil(content.length / 4);
      total = input + output;
    } else if (!input && !output) { input = total; }
    const logged = total > 0 ? await logUsage(jwt, { provider, model, input_tokens: input, output_tokens: output, total_tokens: total, estimated }) : true;
    return response(200, { content, usage: { input, output, total, estimated }, logged });
  } catch (e) {
    return response(500, { error: e.name === 'TimeoutError' ? 'Provider request timed out' : e.message });
  }
}
// Models Fetch
if (event.path.endsWith('/models') || event.httpMethod === 'GET') {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    const data = await response.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data.data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
