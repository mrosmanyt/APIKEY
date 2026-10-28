# Changelog

All notable changes to AI Hub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses semantic versioning.

## [Unreleased]

### Security
- Backups no longer store API keys in plain text. "Include API keys" now requires a
  passphrase (min. 8 characters); keys are encrypted with scrypt (random 16-byte salt) +
  AES-256-GCM (random 12-byte IV). Import asks for the passphrase, reports a wrong
  passphrase clearly without changing any data, and can import everything except the keys.
  Passphrases and keys are never logged. Backup format version 2.

### Changed
- License tools are now dependency-free Node scripts (`tools/*.mjs`): they run on Windows
  with only Node.js installed. `license:generate` asks questions when run without options.
  New `npm run license:check`.
- xAI video and Veo image-to-video are labelled **Beta** in the UI.

### Added
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
