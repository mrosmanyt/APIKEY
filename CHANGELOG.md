# Changelog

All notable changes to AI Hub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses semantic versioning.

## [Unreleased]

### Added — Automation (optional, off by default)
- **Settings › Automation** master switch. When off, the Automation screen is hidden and no
  schedules, folder watchers, webhook server or tray icon run.
- **Workflow builder**: vertical list of steps — Chat/LLM, image, video, TTS, STT, read file,
  write file, HTTP request, condition (if/else with continue / stop / go to), delay and loop.
  Steps reference earlier results with `{{stepId.output}}`.
- **Triggers**: manual, schedule (hourly, daily at a time, weekly, custom cron), folder watch
  and a local webhook (127.0.0.1 only, random token accepted only in the
  `Authorization: Bearer` header, off unless enabled).
- **Batch mode** for every CSV row, TXT line or file in a folder, with a concurrency limit and
  pause / resume / cancel.
- **Templates**: Blog post plus cover image, Bulk image generation from CSV, Transcribe a folder
  of audio files, Translate text files, Daily summary of a text file.
- **Runs history** with status, duration, each step's input/output, estimated cost, errors and
  "Retry from failed step".
- **Safety**: approval before writing outside the output folder or calling any host (loopback
  included); redirects are followed by hand (max 5) and re-checked, so a new host needs its own
  approval; paths are checked after resolving symlinks/junctions, so the app data folder is
  always off-limits; HTTP steps can't call AI Hub's own webhook; per-workflow spending cap and
  max runs per hour.
- **Background**: optional tray mode, "Start AI Hub with Windows" (off by default) and Windows
  notifications when runs finish or fail.
- **Urdu** translations for the whole Automation screen, its templates and Settings › Automation; a test now
  names any English key missing from the Urdu file.
- **Import / export** of workflows as JSON packs (approvals are stripped; imports arrive
  disabled).
- All provider calls still go through the main process with the encrypted keys; keys never
  appear in workflows, run history, logs or exported files.

### Security
- Backups no longer store API keys in plain text. "Include API keys" now requires a
  passphrase (min. 8 characters); keys are encrypted with scrypt (random 16-byte salt) +
  AES-256-GCM (random 12-byte IV). Import asks for the passphrase, reports a wrong
  passphrase clearly without changing any data, and can import everything except the keys.
  Passphrases and keys are never logged. Backup format version 2.
- Restoring a backup validates its settings field by field with the same schema as the
  Settings screen; unknown or invalid fields are skipped (and listed) instead of being copied
  in. **Automation settings are never restored**: Automation, tray mode, start with Windows
  and the webhook stay as they are on this PC. Cached model/voice lists are not restored either
  (they refresh from the providers).

### Changed
- License tools are now dependency-free Node scripts (`tools/*.mjs`): they run on Windows
  with only Node.js installed. `license:generate` asks questions when run without options.
  New `npm run license:check`.
- xAI video and Veo image-to-video are labelled **Beta** in the UI.
- Stability AI moderation errors (HTTP 403) are reported as content-policy refusals, not as an
  invalid key.
- Backups also include the monthly usage used for cost estimates.

### Added
- **New providers:** OpenRouter (live model prices), Groq (chat + Whisper speech-to-text),
  DeepSeek, Mistral AI, Ollama (local models, no key — "Test connection") and Stability AI
  (Stable Image Ultra/Core, SD 3.5). Unverified endpoints are marked `TODO(verify)` and,
  where user-visible, labelled **Beta** (Stability upscaling, Stable Image Ultra
  image-to-image).
- **Cost estimates:** approximate cost on every chat answer, monthly cost per provider and per
  model in Settings › Usage, and an editable price table (USD per 1M tokens, wildcard model
  patterns) in Settings › Prices. Token counts are estimated locally when a provider reports
  none.
- **Chat with files:** attach PDF, DOCX and TXT files; text is extracted locally (page
  numbers kept for PDFs) and sent as context, with a warning when attachments are too large
  for the selected model's context window.
- **Image tools:** "Use as reference" / upload a reference image for image-to-image (OpenAI
  GPT Image, Gemini Flash Image, Stability), **Upscale** (Stability, Beta) and **Variations**
  (OpenAI DALL·E 2).
- **Prompt enhancer:** an "Enhance" button on Chat, Images and Video rewrites a short prompt
  into a detailed one with your chat model (with Undo). New default "Prompt enhancer" model in
  Settings › Defaults.
- **Setup wizard** after license activation: welcome, add keys with links to each provider's
  key page, and a "Test key" step. Can be re-run from Settings › General.
- **Urdu (اردو)** user interface with a full right-to-left layout, selectable in Settings ›
  General › Language.
- **Keyboard shortcuts** (Ctrl+N new chat, Enter send, Esc stop, Ctrl+1…8 screens, Ctrl+L,
  Ctrl+,) and a shortcuts help screen (Ctrl+/ or F1, or the sidebar button).
- Model context-window sizes for the built-in chat models.
- `LICENSE_SETUP.md` step-by-step guide for the seller.
- USER_GUIDE section on the Windows SmartScreen warning for the unsigned installer.
- Pushing a `v*` tag publishes a GitHub Release with the installer attached (after checking
  the tag matches `package.json` and the license key is not the placeholder).
- `.gitattributes` forcing LF line endings so Windows checkouts pass the format check.

## [1.0.0] — 2026-10-28

### Added
- Electron + React + TypeScript desktop app with sidebar navigation, dark/light/system theme
  and i18n-ready UI strings (English).
- Provider adapter layer with registry: OpenAI, Anthropic Claude, Google Gemini, xAI Grok,
  ElevenLabs and a custom OpenAI-compatible provider. Live model-list refresh.
- Settings › API Keys with encrypted storage (Windows DPAPI), key test with real provider
  error messages, and status badges.
- Chat: streaming, stop, regenerate, edit last message, Markdown + syntax highlighting,
  image/text attachments, system prompt, temperature and max tokens.
- Code mode with extracted code-block panel and save-to-file.
- Compare mode (2–3 models side by side).
- Conversation history with search, rename, delete and Markdown/JSON export.
- Image generation with gallery, metadata sidecars, copy/reveal/save/delete.
- Text-to-speech (OpenAI, ElevenLabs) and speech-to-text (OpenAI, ElevenLabs) with
  microphone recording.
- Asynchronous video jobs (OpenAI Sora, Google Veo, experimental xAI) with progress,
  preview, persistence across restarts.
- Friendly error handling with automatic retry/backoff for rate limits and a redacted
  "Details" view.
- Local log file, usage statistics, per-mode defaults, output folder setting, prompt
  library, backup/restore (keys optional).
- Offline Ed25519 license activation, About screen, license generator CLI
  (`tools/generate-license.ts`) and keypair tool.
- Unit tests, ESLint/Prettier, GitHub Actions workflow building the Windows installer.
