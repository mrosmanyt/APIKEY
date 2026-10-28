# AI Hub — User Guide

Welcome! AI Hub lets you use ChatGPT-style chat, image generation, video, voice and coding
assistants from many AI companies in one app, **using your own API keys**. You pay the AI
companies directly for what you use; AI Hub itself has no subscription and no account.

## 1. Install

1. Run **AI-Hub-Setup-x.y.z.exe**.
2. If Windows shows *"Windows protected your PC"*, click **More info → Run anyway**.
3. Choose the install folder and finish. Start **AI Hub** from the Start menu or desktop.

## 2. Activate

On first launch, paste the **license key** you received after purchase (it starts with
`AIHUB1.`) and click **Activate**. Activation works offline. You can see your license under
**Settings → About**.

## 3. Add your API keys

Open **Settings → API Keys**. For each provider you want to use:

1. Click **Get a key** to open the provider's website, create a key and copy it.
2. Paste it into the box and click **Save key**. AI Hub tests it immediately.
3. The badge shows **Valid** (ready to use), **Invalid** (with the provider's error message)
   or **Not tested** (e.g. no internet). Click **Test key** any time to re-check.

Providers without a valid key show **"Add key in Settings"** on the other screens.

Your keys are encrypted with your Windows account and are only sent to the provider they
belong to.

### Where to get each key

| Provider | Where | Notes |
| --- | --- | --- |
| **OpenAI** | https://platform.openai.com/api-keys | Add billing credit at platform.openai.com → Billing. Chat, images, voice, transcription, Sora video. |
| **Anthropic Claude** | https://console.anthropic.com/settings/keys | Buy credits under Plans & Billing. Chat only. |
| **Google Gemini** | https://aistudio.google.com/app/apikey | Free tier available; some image/video models (Imagen, Veo) need billing enabled. |
| **xAI Grok** | https://console.x.ai | Chat and images; video support is experimental. |
| **ElevenLabs** | https://elevenlabs.io/app/settings/api-keys | Voices (text-to-speech) and transcription. Give the key access to Text to Speech, Voices and Speech to Text. |
| **Custom (OpenAI-compatible)** | Depends on the service | For OpenRouter (https://openrouter.ai/keys), Groq (https://console.groq.com/keys), DeepSeek (https://platform.deepseek.com/api_keys), Together, Mistral, or local apps like Ollama / LM Studio. |

**Custom provider setup** — fill in:

- **Base URL**: e.g. `https://openrouter.ai/api/v1`, `https://api.groq.com/openai/v1`,
  `https://api.deepseek.com/v1`, or for Ollama `http://localhost:11434/v1`
  (LM Studio: `http://localhost:1234/v1`).
- **Default model name**: e.g. `openai/gpt-4o`, `llama-3.3-70b-versatile`, `deepseek-chat`, `llama3.2`.
- **Display name** (optional): the name shown in menus.
- **API key**: your key. Local servers without a key accept any text (e.g. `local`).

## 4. Using each screen

### Chat
Pick a **provider** and **model** at the top, type a message and press **Enter**
(Shift+Enter for a new line).

- **Stop** halts the answer. Hover a message to **Copy**, **Regenerate** the last answer, or
  **Edit** your last message and resend.
- **📎** attaches images (for models that can see images) or text/code files. You can also
  drag & drop or paste.
- **⚙ (sliders)** sets the system prompt (instructions for the assistant), temperature
  (creativity) and max tokens (answer length).
- **🔄** next to the model refreshes the model list from the provider. Choose
  **Custom model id…** to type any model name.
- **Compare** sends one prompt to 2–3 models side by side.

### Code
Like Chat, but tuned for programming. Code blocks from answers appear on the right side; use
the buttons to copy them or **save to a file**.

### Images
Pick provider/model, write a prompt (and a negative prompt when supported), choose size or
aspect ratio and number of images, then **Generate**. Images are saved automatically to your
output folder (default `Documents\AI Hub\images`) with a `.json` file describing the prompt.
Click an image to view it large; use the buttons to copy, show in folder, save a copy, reuse
the prompt or delete.

### Audio
- **Text to speech**: choose provider, model and voice (ElevenLabs: click 🔄 to load your own
  voices), type text and click **Generate speech**. Play it, **Save MP3**, or delete it.
- **Speech to text**: **Upload audio file** or **Record from microphone** (allow microphone
  access if Windows asks), optionally set a language code like `en`, then **Transcribe**.

### Video
Write a prompt, optionally choose a start image, size and duration, then **Create video**.
Videos take a few minutes; you can use other screens meanwhile — jobs keep running and even
resume after restarting the app. When done, watch the preview and **Save as…**.

### History
All chats and code conversations. Search, open, rename, delete, or export to Markdown/JSON.

### Prompts
Save favourite prompts, mark them with ★, and click **Use** to send them to the right screen.
You can also insert saved prompts with the 🔖 button on the Chat, Code, Images, Video and
Audio screens.

### Settings
- **API Keys** — add, test, replace and delete keys.
- **Defaults** — provider/model selected by default on each screen.
- **General** — theme, language, output folder, default temperature/max tokens, logs folder.
- **Usage** — requests, tokens (when the provider reports them), images, audio and videos per
  provider. Counted on your PC only; check the provider's website for exact billing.
- **Backup** — export settings, conversations, prompts and usage to one file, and import it on
  another PC. Tick **Include API keys** only if you want keys in the file — they are then
  stored **unencrypted**, so keep that file safe.
- **About** — version, license and data folder.

## 5. Troubleshooting

| Message | What to do |
| --- | --- |
| **Invalid API key** | Copy the key again (no spaces), or create a new one on the provider website, then **Replace key**. |
| **No balance or quota left** | Add credit / enable billing on the provider's website. |
| **Rate limited** | AI Hub already retried automatically. Wait a minute and try again, or use a cheaper/faster model. |
| **Network problem** / offline banner | Check your internet, VPN, proxy or firewall. Corporate networks may block AI services. |
| **Model not found** | The model was renamed or your account has no access. Click 🔄 to refresh models and pick another one. |
| **Blocked by content policy** | The provider refused the request. Rephrase the prompt. |
| Key shows **Not tested** | The test could not reach the provider; check your connection and click **Test key**. |
| Microphone does not record | Windows Settings → Privacy & security → Microphone → allow desktop apps. |
| Video stays "Generating" a long time | Normal for some providers (up to several minutes). If it failed, click **Check again**. |

Click **Details** on any error to see the provider's raw message (keys are always removed).

**Logs**: Settings → General → **Open logs folder**. Logs never contain your API keys. Include
`app.log` when you contact support.

**Where is my data?**
- Settings, history and encrypted keys: `%APPDATA%\AI Hub\`
- Generated files: `Documents\AI Hub\` (change in Settings → General)

**Uninstall**: Windows Settings → Apps → AI Hub → Uninstall. Your data folders are kept; delete
them manually if you want to remove everything.
