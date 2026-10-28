# AI Hub

**AI Hub** is a "bring your own API keys" desktop app for Windows. Buyers install it, paste
their own API keys, and use many AI providers — chat, images, video, text-to-speech,
speech-to-text and coding — from one clean interface.

- No login, no accounts, no credits, no AI Hub server. Everything runs locally.
- API keys are encrypted with Windows DPAPI (Electron `safeStorage`) and never reach the UI.
- Offline license activation with Ed25519-signed license keys.

| Provider | Chat | Images | Video | Text→speech | Speech→text |
| --- | :-: | :-: | :-: | :-: | :-: |
| OpenAI | ✅ | ✅ GPT Image / DALL·E | ✅ Sora | ✅ | ✅ Whisper / GPT-4o Transcribe |
| Anthropic Claude | ✅ | | | | |
| Google Gemini | ✅ | ✅ Gemini Image / Imagen | ✅ Veo (image-to-video: Beta) | | |
| xAI Grok | ✅ | ✅ | ✅ Beta | | |
| ElevenLabs | | | | ✅ | ✅ Scribe |
| Custom OpenAI-compatible (OpenRouter, Groq, DeepSeek, Ollama, LM Studio…) | ✅ | | | | |

## Features

- **Chat** — streaming, stop, regenerate, edit last message, Markdown + code highlighting
  with copy buttons, image/text attachments (vision models), per-chat system prompt,
  temperature and max tokens. **Compare mode** sends one prompt to 2–3 models side by side.
- **Code** — coding-tuned chat with a side panel of extracted code blocks (copy / save to file).
- **Images** — prompt, negative prompt (where supported), size/aspect ratio, count; gallery
  saved to disk with prompt metadata; copy, show in folder, save as, delete.
- **Audio** — text-to-speech (voices, playback, save MP3) and speech-to-text (upload or record).
- **Video** — async jobs: submit → progress → preview → save; job history survives restarts.
- **History** — search, rename, delete, export to Markdown/JSON.
- **Prompt library**, per-mode defaults, usage statistics, backup/restore, logs, dark/light theme,
  i18n-ready strings.
- Friendly errors for invalid key, no quota, rate limits (auto retry with backoff), offline,
  model not found and content-policy refusals — each with a "Details" toggle (redacted).

## Development

Requirements: **Node.js 22+** and npm. Windows is needed only to *build* the installer locally
(GitHub Actions builds it for you on every push).

```bash
npm install
```

```bash
npm run dev
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm test` | Run unit tests (Vitest) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run typecheck` | TypeScript checks (main + renderer) |
| `npm run build` | Typecheck and compile to `out/` |
| `npm run build:win` | Build the Windows NSIS installer into `release/` |
| `npm run license:keypair` | Create your license signing keypair (once) |
| `npm run license:generate` | Create a license key for a buyer (asks questions) |
| `npm run license:check` | Fail if the app still has the placeholder license key |

Development conveniences (unpackaged builds only):

- The license screen has a **Skip (development build only)** button.
- `AIHUB_MOCK_PROVIDER=1 npm run dev` adds a fake "Mock provider (dev)" with every capability,
  so you can click through all screens without spending API credit. It is never included in
  packaged builds.
- `AIHUB_USER_DATA_DIR=<folder>` uses a separate data folder (handy for testing).
- On Linux without a keyring, `AIHUB_ALLOW_PLAINTEXT_KEYS=1` lets you save keys in dev.

### Project layout

```
src/
  main/        Electron main process: window, IPC (zod-validated), storage, services, license
  preload/     contextBridge API (window.aihub) + its TypeScript types
  providers/   Provider adapter layer — one folder per provider + registry
  renderer/    React UI (pages, components, i18n)
  shared/      Types and helpers shared by all processes (incl. secret redaction)
tools/         License keypair/key generator (NOT bundled in the app)
tests/         Vitest unit tests
build/         Icons used by electron-builder
```

## Building the Windows installer

Locally on Windows:

```bash
npm run build:win
```

The installer is written to `release/AI-Hub-Setup-<version>.exe`.

**GitHub Actions:** every push runs `.github/workflows/build.yml`: lint, format check,
typecheck and tests on Ubuntu, then builds the installer on `windows-latest` and uploads it
as the **AI-Hub-Windows-Installer** artifact (kept 30 days). Download it from the
repository's **Actions** tab → pick a run → **Artifacts** section.

**Releases (permanent downloads):** push a tag named `v` + the `package.json` version:

```bash
git tag v1.0.0
```

```bash
git push origin v1.0.0
```

The workflow then also checks that the tag matches `package.json` and that the license public
key is not the placeholder, builds the installer and publishes a **GitHub Release** with
`AI-Hub-Setup-<version>.exe` attached (tags containing `-`, e.g. `v1.1.0-beta.1`, become
pre-releases). Release assets do not expire.

The installer is not code-signed; Windows SmartScreen will show "Windows protected your PC"
→ *More info* → *Run anyway*. To sign, buy a code-signing certificate and set the standard
electron-builder `CSC_LINK` / `CSC_KEY_PASSWORD` secrets in the workflow.

Change the app name, version and icon in:

- `package.json` → `version`, `productName`
- `electron-builder.yml` → `appId`, `productName`, `copyright`
- `build/icon.png` (512×512) and `build/icon.ico` — placeholders generated by
  `npm run icon`; replace with your artwork.

## License keys (selling the app)

**Step-by-step guide for Windows: [LICENSE_SETUP.md](LICENSE_SETUP.md).**

AI Hub verifies licenses **offline**: a license key is a small JSON payload (name, email,
id, issue date, optional expiry) signed with your **Ed25519 private key**. The app only
contains the **public key**, so nobody can create keys without your private key.

The tools in `tools/*.mjs` are plain JavaScript using only Node.js built-ins — they run with
just Node installed (no `npm install`), on Windows, macOS or Linux:

1. `npm run license:keypair` (once) — writes `keys/license-private.pem` (git-ignored; back it
   up, never commit it) and embeds the public key in `src/main/license/publicKey.ts`, which
   you commit.
2. `npm run license:generate` — prompts for buyer name/email/order id/expiry and prints the
   `AIHUB1.…` key; or pass `-- --name "Jane Doe" --email jane@example.com --id ORDER-1001`
   (`--expires 2027-12-31`, `--key path/to/private.pem` optional). Every key is logged in
   `keys/issued-licenses.csv`.

> The repository ships with a placeholder public key whose private key was destroyed. Tag
> builds refuse to publish a release until you have replaced it (`npm run license:check`).

`tools/license-lib.mjs` must stay compatible with the app's verifier
(`src/main/license/core.ts`); `tests/license-tools.test.ts` runs the CLIs with plain `node`
and verifies their keys with the app code.

## Adding a new provider

No UI changes are needed — the UI reads capabilities from the registry.

1. Create `src/providers/<name>/index.ts` exporting a `ProviderAdapter`
   (see `src/providers/types.ts`):

   ```ts
   import { requestJson } from '../http'
   import { streamOpenAIChat } from '../shared/openai-compatible'
   import type { ProviderAdapter } from '../types'

   export const myAdapter: ProviderAdapter = {
     id: 'myprovider',
     name: 'My Provider',
     description: 'What it offers',
     keyUrl: 'https://example.com/api-keys',
     keyPlaceholder: 'mp-...',
     async testKey(ctx) {
       await requestJson(ctx, 'myprovider', 'https://api.example.com/v1/models', {
         headers: { Authorization: `Bearer ${ctx.apiKey}` }
       })
     },
     chat: {
       models: [{ id: 'my-model', name: 'My Model', vision: false }],
       stream: (ctx, req, h) =>
         streamOpenAIChat(ctx, req, h, { providerId: 'myprovider', baseUrl: 'https://api.example.com/v1' })
     }
     // optional: image, tts, stt, video, listModels
   }
   ```

2. Add it to `ADAPTERS` in `src/providers/registry.ts`.
3. Add tests in `tests/` using `mockFetch` from `tests/helpers/fakes.ts`.

Use `fetchWithRetry` / `requestJson` / `requestBinary` from `src/providers/http.ts` — they
give you automatic retries, error classification (`invalid_key`, `quota`, `rate_limit`, …)
and redaction for free. Throw `ProviderError` for provider-specific failures.

## Security model

See [DECISIONS.md](DECISIONS.md) for details. In short: keys encrypted with DPAPI and used
only in the main process; `contextIsolation`, `sandbox`, no `nodeIntegration`; a strict
preload API; zod validation on every IPC call; CSP; navigation blocked; secret redaction in
logs and errors; backups only contain API keys encrypted with a user passphrase
(scrypt + AES-256-GCM).

## Documentation

- [USER_GUIDE.md](USER_GUIDE.md) — guide for buyers
- [LICENSE_SETUP.md](LICENSE_SETUP.md) — creating your license keys (seller)
- [DECISIONS.md](DECISIONS.md) — design decisions
- [CHANGELOG.md](CHANGELOG.md)
