# AI Hub (Netlify + Supabase)

## Deploy
- Publish directory: `public`
- Functions directory: `netlify/functions`
- Keep provider API keys in Netlify environment variables, never in browser code.

## Required Netlify environment variables
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `ADMIN_EMAIL`
- `ADMIN_USERNAME`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `CEREBRAS_API_KEY` (new, optional; free tier)
- `OPENAI_API_KEY` (optional; API billing is separate from ChatGPT subscriptions)

## Features in this build
- Supabase-backed chats and folders
- Search current chat or all chat content
- Cross-chat context checkbox, limited to chats in the same folder (including unfiled chats)
- Text/code/CSV/JSON and text-based PDF attachments; 100 MB/file and 40,000 extracted characters/file limit
- Drag-and-drop attachments and dragging chats onto folders
- Ctrl/Cmd-click multiple chats/folders and bulk move/delete actions
- Home dashboard categories/workspaces with editable icon, colour, tile size, shape, and drag-reordering
- Curated AI tool directory grouped by study, writing, coding/STEM, productivity, creative/media, and career
- Free-tier-capable model presets for Gemini, Groq, and OpenRouter. Free quotas and model availability can change; `openrouter/free` selects an available free route when supported.

## Database
**You must re-run `supabase.sql` in the Supabase SQL Editor for this update.** It is safe to re-run, and adds `token_usage` and `user_settings` tables plus a `token_usage_totals` function. Without it the app still works, but the token meter shows "Usage sync unavailable".

## Notes
- Category layout preferences are stored in this browser's local storage; they do not automatically sync to other devices.
- Media links in the AI directory open external services. They are not API integrations and may require separate accounts or have separate free-tier limits.
- Cross-chat memory is keyword matching, not semantic vector search. Review sensitive content before enabling it.
- Back up the existing GitHub repository and Supabase data before replacing a deployed version.

## Latest AI directory and token meter update
- AI directory now includes the requested tools in Study & Learning, Writing & Assignments, Research & Citations, Lecture & Note-Taking, Coding & STEM, Presentations & Design, Image Generation, Image Editing, and Video Editing.
- Gemini, Groq, and OpenRouter cards open a configured model inside AI Hub. ChatGPT, Mistral, Perplexity, Copilot, Canva, Gamma, Clipdrop, Neural.Love, and Runway currently open their official websites; they are not all API-integrated into this app.
- A draggable token-usage panel reports provider-returned input/output/total tokens when the provider returns usage metadata. Collapse or hide it; its position and totals are saved in this browser. If a provider omits token metadata, the counter cannot estimate exact usage.
- Uploads accepted by this app: `.txt`, `.md`, `.csv`, `.json`, `.js`, `.ts`, `.html`, `.css`, `.xml`, `.py`, `.java`, `.sql`, `.log`, and text-based `.pdf`. It extracts text in the browser and passes it to the selected model as prompt text. It does not send native image/audio/video/Word/Excel files. Per-file size limit is 100 MB, at most 4 attachments per message, and extracted text is capped at 40,000 characters per file. Scanned PDFs may yield no text.
- The upload hint displays the selected provider/model and current accepted file formats in the composer area.


## Update: free models, synced token meter, images, formatting
**Free models** (verified Oct 2026; free tiers change often)
- Gemini (10): gemini-3.8-flash, 3.7-flash, 3.6-flash, 3.5-flash, 3.5-flash-lite, 3.1-flash-lite, 3-flash-preview, 2.5-pro, 2.5-flash, 2.5-flash-lite
- Groq (7): gpt-oss-120b, gpt-oss-20b, llama-3.3-70b-versatile, llama-3.1-8b-instant, qwen3.6-27b, groq/compound, groq/compound-mini
- OpenRouter: the **live** list of free text models is fetched from OpenRouter each session (cached 1 h), so it never goes stale; a built-in list of 18 is the fallback. `openrouter/free` is first.
- Cerebras (new provider, 2): gpt-oss-120b, qwen-3.8-27b
- 👁 in the model list = accepts images.

**Token meter**: usage is recorded server-side per response in Supabase, so every device on the login sees the same totals (refreshes every 30 s, on focus, and after each reply). Today / this week (Mon-start) / this month, shown as used, left and %, coloured green (<60%), amber (60-85%), orange (85-100%), red (limit reached). Scope: this model, this provider, or all. Limits come from (1) your own limits ("Set limits", synced to your login), else (2) published daily token caps built in for Groq models and Cerebras, else (3) shown as "Usage limit unspecified". Gemini and OpenRouter don't publish token limits, so they show unspecified until you set one. Periods use the device's local time. Only usage through AI Hub is counted.

**Images**: paste (Ctrl/Cmd+V), attach or drag images. They are shrunk in the browser (so a 100 MB photo is fine) and sent to the model; only the two most recent image messages are re-sent with pictures.

**Formatting**: markdown (bold, italic, `<u>` underline, strike, headings, lists, task lists, tables, quotes, code blocks with Copy, links, images). Ctrl/Cmd+B/I/U format your input. The "Aa Rich/Plain" button switches to plain text (links clickable, images shown); synced to your login; each assistant message also has its own toggle.

**Netlify note**: requests are capped at about 6 MB by Netlify Functions, which is why images are compressed first. The 100 MB limit applies to the file you pick; for text/PDF only the first 40,000 characters are sent.


## Multi-user accounts and your own API keys
- **Everyone signs in with email + password.** The admin can still type the admin username. Chats, folders, token usage, limits and keys are private to each account (enforced by Supabase row-level security).
- **Add users** in Supabase: Authentication -> Users -> Add user (tick auto-confirm). **Turn off public sign-ups** (Authentication -> Sign In / Providers -> "Allow new users to sign up" off), otherwise anyone could register.
- **API keys**: Settings -> API keys. Each user enters their own keys. Keys are encrypted by the Netlify function (AES-256-GCM, bound to user + provider) with `KEY_ENCRYPTION_SECRET`, stored in `user_api_keys`, and never sent back to the browser (only the last 4 characters).
- **Server keys are optional.** If `GEMINI_API_KEY` etc. exist in Netlify, only the admin account can use them (their own saved key wins). Other users never use them. You can delete all of them.
- **Required new variable:** `KEY_ENCRYPTION_SECRET` (16+ chars, mark as secret). If you change or lose it, saved keys cannot be decrypted and users must re-enter them.
- Trust note: this protects keys from database leaks, not from the site owner, who controls the server secret.
- Re-run `supabase.sql` once more (adds `user_api_keys`).


## Update: served-model check, usage donuts, per-model limits
- **Served model**: every reply shows which model the provider says answered. Green "served by X" = matches (or a versioned build of it); amber "requested X → served Y" = the provider answered with a different model; "router picked Y" for `openrouter/free`. If a provider doesn't report it, the reply says so.
- **Donut charts** in the token panel for today / week / month: red = used, green = left, grey dashed = no limit set.
- **Token limits manager** ("Set limits"): set day/week/month limits for any individual model, for a whole provider key, or for everything combined. Saved to your login. Grey hints show published free-tier caps. Sending while a limit is already used up asks for confirmation first (it warns; it does not hard-block).
