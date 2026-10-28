# Changelog

All notable changes to AI Hub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses semantic versioning.

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
