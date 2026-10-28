# Design decisions

This file records choices made while building AI Hub, and why.

## Stack & tooling

- **electron-vite 2 + Vite 5 + React 18 + TypeScript 5.9 + Tailwind 3.** Chosen over the very
  newest majors (Vite 8, React 19, TS 7, Tailwind 4) because these versions are mature, well
  documented and known to work together. Upgrading later is straightforward.
- **Electron 45** (current stable at build time) for up-to-date Chromium security fixes. Electron
  45 replaced the old clipboard image API with `clipboard.write([new ClipboardItem(...)])`, which
  the app uses.
- **All npm packages are devDependencies.** electron-vite bundles the main, preload and renderer
  code, so the packaged app ships no `node_modules` at all → small installer, no native modules.
- **ESLint 9 flat config + Prettier.** CI runs lint, format check, typecheck and tests.

## Storage: JSON files instead of SQLite

`better-sqlite3` is a native module that must be rebuilt for Electron's Node ABI, which
complicates CI, Vitest (runs under plain Node) and Windows builds. Data volume for a desktop
chat client is small, so the app uses JSON files in `%APPDATA%\AI Hub\data`:

- atomic writes (temp file + rename) so a crash never leaves a half-written file;
- corrupt files are renamed to `*.corrupt-<timestamp>` and the app continues with defaults;
- one file per conversation (`data/conversations/<id>.json`) so large histories stay fast.

Generated media are regular files in the output folder (default `Documents\AI Hub`), with a
`.json` sidecar next to each image containing its prompt metadata.

## Security

- **Keys** are encrypted with Electron `safeStorage` (Windows DPAPI, tied to the Windows user)
  and only decrypted in the main process right before a request. The renderer only sees the last
  four characters (`keyHint`) and the status.
- If secure storage is unavailable the app refuses to save keys rather than storing them in
  plain text. (Linux developers can opt in to Chromium's fallback key with
  `AIHUB_ALLOW_PLAINTEXT_KEYS=1` in dev builds only.)
- The synchronous `safeStorage` API is marked deprecated in Electron 45 in favour of the async
  one, but is still fully supported; it is wrapped behind the `Encryptor` interface so switching
  is a one-file change.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
  The preload exposes a fixed list of functions (`window.aihub`), never `ipcRenderer` itself.
- Every IPC handler validates its arguments with **zod** and checks the sender frame URL.
- **CSP** is injected into the built `index.html` (no inline scripts, no remote origins). It is
  not applied to the Vite dev server because React Fast Refresh needs inline scripts.
- Media is served to the renderer through a custom `aihub-media://<kind>/<id>` protocol that
  only resolves files referenced by the app's own records — no arbitrary file access.
- Navigation and `window.open` are blocked; https links open in the system browser.
- Only microphone (audio-only) and clipboard-write permissions are granted.
- **Redaction**: every log line and every error that reaches the UI passes through
  `src/shared/redact.ts`, which removes all registered keys exactly plus anything that looks
  like a key (provider prefixes, bearer tokens, `x-api-key` headers, `?key=` params, long
  opaque tokens).
- Provider HTTP calls use Electron's `net.fetch` (Chromium network stack: honours system proxy
  and certificate settings, which matters on corporate Windows machines).

## Providers

- One `ProviderAdapter` interface with optional capabilities; the registry turns adapters into
  serialisable `ProviderInfo` for the UI. The UI has no provider-specific code.
- A provider is "usable" in the app only when its key has been **tested valid**. A key is
  tested automatically right after saving. Network/server errors during a test leave the key as
  "Not tested" rather than "Invalid".
- Built-in model lists are a starting point; "Refresh" fetches the live list from each API
  where supported and caches it in settings. Users can also type any model id ("Custom model
  id…"), so new models work without an app update.
- OpenAI: newer reasoning models (o-series, GPT-5 family) reject `temperature` and use
  `max_completion_tokens`; the adapter handles that.
- Anthropic temperature is clamped to 0–1 (its allowed range).
- Text/code attachments are inlined into the message text for every provider; images are sent
  in each provider's native vision format.
- **Custom OpenAI-compatible provider**: one configurable endpoint (base URL + key + default
  model + optional display name). Local servers without auth accept any placeholder key.
- **Retries**: rate limits (429/529) and transient 5xx/network failures are retried up to 3
  times with exponential backoff + jitter, honouring `Retry-After` (capped at 30 s). Quota /
  billing errors (often also HTTP 429) are detected from the body and *not* retried. Streaming
  responses are only retried before the stream starts.

## Video

Generic async job flow in `src/main/services/video.ts` (submit → poll every 5–15 s → download
into the output folder). Jobs are persisted and resumed after an app restart; timeout 60 min.

- **OpenAI Sora** (`/v1/videos`) and **Google Veo** (`:predictLongRunning`) implemented.
- Unverified features are labelled **Beta** in the UI: all of xAI video (adapter flag
  `experimental`) and Veo image-to-video (model flag `imageInputBeta`).
- **xAI video** is implemented as an *experimental* adapter: its API details could not be
  verified against official docs while building (no network access to docs.x.ai from the build
  environment). It is marked `experimental: true`, labelled in the UI, and the uncertain parts
  are marked `TODO(verify)` in `src/providers/xai/index.ts`.
- Veo's image-to-video payload shape is also marked `TODO(verify)`.
- "Stop waiting" stops polling locally; providers do not uniformly support cancelling a job.

## Licensing

- Offline Ed25519 signatures with Node's built-in `crypto` (no dependency). The seller's
  tools (`tools/*.mjs`) are plain JavaScript with only Node built-ins so they run on a
  Windows PC with just Node installed (no `npm install`, no Electron download, no TS
  runner). `tests/license-tools.test.ts` keeps them compatible with the TS verifier. Key format:
  `AIHUB1.<base64url payload>.<base64url signature>`.
- The public key is embedded in `src/main/license/publicKey.ts`. The committed key is a
  **placeholder whose private key was discarded** — the seller must run
  `npm run license:keypair` once before building a release.
- The license screen offers "Skip" only in unpackaged development builds.
- All IPC channels except `app:*` and `license:*` are refused until a license is active.

## Backup

A single JSON file (format version 2) containing settings, conversations, prompts and usage.
Generated media files are not included (they are already plain files in the output folder).

API keys are only included when the user ticks "Include API keys", and then **always
encrypted** with a passphrase they choose (min. 8 characters, entered twice):

- Key derivation: `scrypt` (N=2^15, r=8, p=1), random 16-byte salt → 32-byte key. The cost
  parameters are stored in the file so they can be raised later; on import, absurd values
  from a tampered file are refused (memory-exhaustion guard).
- Encryption: AES-256-GCM, random 12-byte IV, 16-byte auth tag, the format name as
  additional authenticated data. The file stores `{kdf, N, r, p, cipher, salt, iv, authTag,
  ciphertext}` — never the plain keys.
- Why not DPAPI? A DPAPI-encrypted backup could only be restored by the same Windows user on
  the same PC, which defeats the purpose of moving to a new PC.
- Import is two steps (pick file → preview → passphrase). Keys are decrypted *before* anything
  is written, so a wrong passphrase (GCM authentication failure) changes nothing and the user
  can retry or choose "Import without keys". Restored keys are tested automatically.
- The passphrase is registered with the redactor for the duration of the IPC call so it can
  never appear in a log line or error, and is never stored. It travels renderer → main over
  IPC once, like an API key does when first saved.
- Legacy v1 files (plain keys, only produced by pre-release builds) can still be imported.

## i18n

All UI strings live in `src/renderer/src/i18n/en.ts` with a typed `t('section.key')` helper and
`{placeholder}` interpolation. Adding a language = one new dictionary file + one line in
`i18n/index.ts`.

## UI

- Pages stay mounted after their first visit (hidden with CSS) so a streaming answer, a form
  in progress or an ongoing recording survive switching screens.
- Navigation is a fixed sidebar (Chat, Images, Video, Audio, Code, History, Prompts, Settings);
  the sidebar collapses to icons on narrow windows. Compare mode lives inside Chat.
- "Usable" provider pickers show all providers that have a capability, but disable those
  without a valid key ("— add key in Settings") so users discover what is available.
- First launch with no keys opens Settings › API Keys directly.

## Automation

- **Opt-in module.** `settings.automation.enabled` defaults to false. `AutomationService.apply()`
  starts schedules, folder watchers and the webhook only when it is on, and `stopAll()` tears
  them down (aborting running runs and pausing batches) when it is turned off. Every
  `automation:*` IPC channel except `status` refuses to work while it is off, and the renderer
  unmounts the screen.
- **Engine in the main process.** Workflows are data (zod-validated); the engine calls the same
  `AiService`/`VideoService` code the screens use, so keys stay in the main process. Step inputs
  and outputs stored in run history are redacted with `shared/redact.ts`, truncated, and header
  values with secret-looking names are stored as `[hidden]`.
- **Approvals, not sandboxes.** A workflow may write inside the output folder freely; anything
  else needs a per-folder approval stored on that workflow. Every HTTP host needs a per-host
  (host:port) approval — loopback included, since local services (Ollama, admin panels) are as
  sensitive as remote ones; URLs with credentials are rejected. The app data folder (keys,
  license, stores) can never be read or written, and is refused before approval is considered,
  so the user is never asked to approve it. Paths are compared after `fs.realpathSync.native`
  (for a file that doesn't exist yet, the nearest existing parent), so symlinks and junctions
  can't reach the data folder; file I/O then uses the resolved path.
- **Redirects** are followed by the engine, not the transport: each hop goes through the same URL
  check (a new host needs approval; loopback and the webhook port are refused), at most 5 hops,
  `Authorization`/`Cookie` are dropped when the origin changes, and 303 (or 301/302 after POST)
  becomes GET. Electron's `net.fetch` rejects `redirect: 'manual'` ("Redirect was cancelled")
  instead of returning the 3xx, so `src/main/net-fetch.ts` implements `'manual'` with
  `net.request` (still Chromium's network stack: system proxy and certificates).
- **No self-triggering.** HTTP steps can never target the local webhook port on a loopback
  address (in any spelling: `127.1`, `2130706433`, `[::ffff:127.0.0.1]`, `localhost.`), and every
  step request carries `X-AI-Hub-Automation: 1`, which the webhook refuses — this also covers a
  DNS name that resolves to 127.0.0.1. Approvals are known up front where paths/URLs
  are literal (preflight before a manual run); otherwise the run stops with "Needs approval"
  and can be approved and retried. The editor's save cannot add approvals — only the approve
  call can — and imports/exports drop them.
- **Cost estimates for caps** use token counts × per-1M prices and flat per-item prices from
  Settings › Automation. They are deliberately simple and labelled as estimates.
- **Scheduling** uses a small built-in 5-field cron parser (day-of-month/day-of-week OR
  semantics like Vixie cron) instead of a dependency; timers are re-armed in ≤ 24 h chunks so
  sleep/clock changes don't cause drift beyond one chunk.
- **Folder watch** polls (with `fs.watch` as a hint to scan sooner) because `fs.watch` alone is
  unreliable on network drives, and reports a file only once its size is stable, so half-copied
  files are not processed.
- **Webhook** binds to 127.0.0.1 only, uses a 24-byte random token compared in constant time and
  accepted only in the `Authorization: Bearer` header (never the query string, which leaks into
  logs and history), limits bodies to 1 MB and is off unless enabled.
- **Background.** Tray mode keeps the app alive when the window is closed; "Start with Windows"
  registers a login item with `--hidden` (packaged builds only) and is only offered when tray
  mode is on.

## Development helpers

- A **mock provider** (`src/providers/mock`) with every capability can be enabled with
  `AIHUB_MOCK_PROVIDER=1` in unpackaged builds. It was used to verify every screen end-to-end
  during development and is never registered in packaged builds.
- `AIHUB_USER_DATA_DIR` overrides the data folder (used for automated UI checks).

## Releases

- Every push builds an installer artifact (30-day retention). Pushing a `v*` tag additionally
  publishes a GitHub Release via `softprops/action-gh-release` (assets never expire). Only the
  release job gets `contents: write`.
- Tag builds fail early if the tag doesn't match `package.json` (the installer file name uses
  that version) or if the license public key is still the placeholder (a release that nobody
  can license would be useless).
- `.gitattributes` forces LF so a Windows checkout (Git's `core.autocrlf`) can't produce CRLF
  files that fail the Prettier check in CI.

## Providers added in v1.1

- **OpenRouter, Groq, DeepSeek, Mistral** share `compatProvider()`. `stream_options.include_usage`
  is only sent to servers known to accept it (OpenAI, xAI, DeepSeek, OpenRouter); Groq's
  usage is read from `x_groq.usage`; everything else falls back to a local estimate.
- OpenRouter's key test uses `GET /auth/key` (`TODO(verify)`); its `/models` list provides
  per-token prices, converted to USD per 1M tokens and used for cost estimates.
- **Mistral** image input is disabled: its image part format differs from OpenAI's.
- **Ollama** is a keyless provider (`keyOptional`): "Test connection" stores an empty key entry
  so the existing status logic works; no `Authorization` header is sent. Its model list comes
  from `/api/tags` and is refreshed automatically after a successful test (also for any
  provider without built-in models, e.g. Custom).
- **Stability AI** uses the v2beta Stable Image endpoints with `Accept: image/*`. A
  `finish-reason: CONTENT_FILTERED` header (HTTP 200 with a blurred image) is turned into a
  content-policy error, and HTTP 403 moderation errors are now classified as content policy
  before the generic "403 = invalid key" rule. Upscaling (`/upscale/fast`) and Ultra's
  image-to-image are marked Beta / `TODO(verify)`.

## Cost estimates

- Prices live in `settings.prices` (USD per 1M tokens), seeded with approximate list prices
  from `src/shared/pricing.ts`. Matching: exact model id > longest `prefix*` > `*`; then
  provider-reported pricing (OpenRouter); otherwise "no price" (never guessed).
- Usage is stored per month / provider / model as **tokens**, and cost is computed when
  displayed — editing a price immediately corrects past months too.
- Providers that report no usage get a local estimate (~4 characters per token), flagged
  `estimated` and shown with "≈". Stopped answers record the tokens produced so far.
- Only chat tokens are priced; images, audio and video are counted but not priced (their
  pricing models differ per provider).

## Documents in chat

- PDF (via `unpdf`, a dependency-free pdf.js build), DOCX (`mammoth`) and TXT are extracted in
  the **main process** (no PDF worker or CSP changes in the renderer); text is cleaned, PDF
  pages are labelled, and output is capped at 1.5M characters (marked truncated).
- The "too large" warning compares an estimate of attachment tokens with the model's
  `contextWindow` (80% threshold, leaving room for the answer); unknown models assume 128k
  and say so.

## Image tools

- Optional adapter methods `image.upscale` / `image.vary` and per-model `supportsReference`;
  the UI shows a tool only when at least one usable provider offers it, and asks which
  provider when several do. Results record `operation` and `sourceImageId`.

## Prompt enhancer

- Non-streaming call through the normal chat adapter with a target-specific system prompt
  (chat / image / video); the reply is cleaned of "Here is…" wrappers, quotes and fences.
  Model choice: current chat selection → "Prompt enhancer" default → Chat default → first
  usable chat model. Usage and cost are recorded like any chat request.

## Onboarding, Urdu, shortcuts

- The wizard is driven by `settings.onboardingCompleted`; users upgrading with keys already
  saved skip it automatically. It reuses the Settings provider cards.
- Urdu: `ur.ts` is typed as `Dictionary`, so a missing key fails the build; a test checks
  identical `{placeholders}` and that every value is in Urdu script. RTL uses `dir="rtl"` on
  `<html>` plus Tailwind logical classes (`ms-/me-/ps-/pe-/border-s/e/text-start/end`); code,
  keys, URLs and numbers stay LTR, and message bodies use `dir="auto"`. Changing the language
  remounts the main layout so every screen re-renders.
- Shortcuts match physical key codes (`e.code`) so they work on any keyboard layout; Esc
  closes dialogs before it stops generation.
