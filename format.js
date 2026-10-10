// Message formatting for AI Hub.
// Everything is HTML-escaped first; only a fixed whitelist of tags is ever emitted,
// and links/images are restricted to safe URL schemes. No external libraries.

export const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NUL = '\u0000';
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
const SAFE_IMG = /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i;
// Inline HTML tags the model/user may use. No attributes are ever allowed.
const ALLOWED_TAGS = new Set(['u', 'ins', 'mark', 'sub', 'sup', 's', 'del', 'strike', 'kbd', 'b', 'i', 'em', 'strong']);

function makeStash() {
  const items = [];
  return {
    put(html) { items.push(html); return NUL + (items.length - 1) + NUL; },
    // Stashed html may itself contain placeholders (e.g. a link label containing code), so restore repeatedly.
    restore(s) {
      let out = s;
      for (let i = 0; i < 6 && out.includes(NUL); i++) out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => items[+n] ?? '');
      return out;
    }
  };
}

const unescapeAmp = u => u.replace(/&amp;/g, '&');
const cleanUrl = u => String(u).trim().replace(/^<|>$/g, '');

function imgHtml(url, alt) {
  const src = cleanUrl(url);
  if (!SAFE_IMG.test(src)) return null;
  return `<img class="mdImg" src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}" loading="lazy" referrerpolicy="no-referrer">`;
}
function linkHtml(url, labelHtml) {
  const href = cleanUrl(url);
  if (!SAFE_LINK.test(href)) return null;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${labelHtml}</a>`;
}

// Turn bare URLs inside already-escaped text into links.
function autolink(escaped, st) {
  return escaped.replace(/https?:\/\/(?:(?!&lt;|&gt;|&quot;)[^\s\u0000])+/g, m => {
    const trail = (m.match(/[.,;:!?)\]}]+$/) || [''])[0];
    const url = trail ? m.slice(0, -trail.length) : m;
    const a = linkHtml(unescapeAmp(url), url);
    return a ? (st ? st.put(a) : a) + trail : m;
  });
}

const IMG_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|\S+?)(?:\s+"[^"]*")?\s*\)/g;
const LINK_RE = /\[([^\]]+)\]\(\s*(<[^>]+>|\S+?)(?:\s+"[^"]*")?\s*\)/g;

export function inline(src) {
  const st = makeStash();
  let t = String(src);

  // 1. code spans
  t = t.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => st.put(`<code>${escapeHtml(code.replace(/^ (.*) $/s, '$1'))}</code>`));
  // 2. images, then links (label supports emphasis)
  t = t.replace(IMG_RE, (m, alt, url) => { const h = imgHtml(url, alt); return h ? st.put(h) : m; });
  t = t.replace(LINK_RE, (m, label, url) => {
    const h = linkHtml(url, '\u0001L\u0001');
    return h ? st.put(h.replace('\u0001L\u0001', () => emphasis(escapeHtml(label)))) : m;
  });
  // 3. whitelisted inline html tags (no attributes), kept balanced so an unclosed <u> can't leak into later blocks
  const open = [];
  t = t.replace(/<(\/?)([a-zA-Z]+)\s*\/?>/g, (m, close, name) => {
    const n = name.toLowerCase();
    if (n === 'br') return st.put('<br>');
    if (!ALLOWED_TAGS.has(n)) return m;
    if (!close) { open.push(n); return st.put(`<${n}>`); }
    const at = open.lastIndexOf(n);
    if (at < 0) return '';
    const closes = open.splice(at).reverse().map(x => `</${x}>`).join('');
    return st.put(closes);
  });
  // 4. escape what's left, autolink, emphasis
  t = escapeHtml(t);
  t = autolink(t, st);
  t = emphasis(t);
  t = t.replace(/\n/g, '<br>');
  t += open.reverse().map(x => `</${x}>`).join('');
  return st.restore(t);
}

function emphasis(t) {
  return t
    .replace(/\*\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^\s_](?:[^_\n]*?[^\s_])?)_(?![\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

const FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)[^\n]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = []; let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isBlockStart = (line, next) =>
  FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line) ||
  (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('|'));

function renderList(items) {
  let html = ''; const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += '</li></' + stack.pop().tag + '>';
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      html += `<${tag}${it.ordered && it.num !== 1 ? ` start="${it.num}"` : ''}>`;
      stack.push({ tag, indent: it.indent });
    } else if (top.tag !== (it.ordered ? 'ol' : 'ul')) {
      // same indent but a different list type: end this list and start a new one
      html += '</li></' + stack.pop().tag + '>';
      const tag = it.ordered ? 'ol' : 'ul';
      html += `<${tag}${it.ordered && it.num !== 1 ? ` start="${it.num}"` : ''}>`;
      stack.push({ tag, indent: it.indent });
    } else html += '</li>';
    let text = it.text, box = '';
    const task = text.match(/^\[( |x|X)\]\s+/);
    if (task) { box = `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> `; text = text.slice(task[0].length); }
    html += '<li>' + box + inline(text);
  }
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  return html;
}

function blocks(lines) {
  let html = ''; let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m = line.match(FENCE);
    if (m) {
      const marker = m[1][0], len = m[1].length, lang = m[2]; const buf = []; i++;
      while (i < lines.length && !(new RegExp(`^\\s{0,3}\\${marker}{${len},}\\s*$`)).test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<div class="codeBlock"><div class="codeHead"><span>${escapeHtml(lang || 'text')}</span><button type="button" class="copyCode">Copy</button></div><pre><code>${escapeHtml(buf.join('\n'))}</code></pre></div>`;
      continue;
    }
    if ((m = line.match(HEADING))) { html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
    if (HR.test(line)) { html += '<hr>'; i++; continue; }
    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].match(QUOTE)[1]);
      html += `<blockquote>${blocks(buf)}</blockquote>`; continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      const head = splitRow(line), seps = splitRow(lines[i + 1]);
      const align = seps.map(s => s.startsWith(':') && s.endsWith(':') ? 'center' : s.endsWith(':') ? 'right' : s.startsWith(':') ? 'left' : '');
      i += 2; const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
      html += `<div class="tableWrap"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if (LIST.test(line)) {
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(LIST);
        if (lm) { items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), num: parseInt(lm[2], 10) || 1, text: lm[3] }); i++; }
        else if (lines[i].trim() && /^\s+\S/.test(lines[i]) && items.length) { items[items.length - 1].text += '\n' + lines[i].trim(); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1])) i++;
        else break;
      }
      html += renderList(items); continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines[i], lines[i + 1]))) buf.push(lines[i++]);
    html += `<p>${inline(buf.join('\n'))}</p>`;
  }
  return html;
}

export function renderMarkdown(src) {
  return blocks(String(src ?? '').replace(/\r\n?/g, '\n').split('\n'));
}

// Plain mode: show the text exactly as written (markup characters stay visible),
// but still make links clickable and still display images.
export function renderPlain(src) {
  const st = makeStash();
  let t = String(src ?? '').replace(/\r\n?/g, '\n');
  t = t.replace(IMG_RE, (m, alt, url) => { const h = imgHtml(url, alt); return h ? st.put(h) : m; });
  t = t.replace(LINK_RE, (m, label, url) => { const h = linkHtml(url, escapeHtml(label)); return h ? st.put(h) : m; });
  t = autolink(escapeHtml(t), st);
  return st.restore(t);
}
