# AI Hub — User Guide

Welcome! AI Hub lets you use ChatGPT-style chat, image generation, video, voice and coding
assistants from many AI companies in one app, **using your own API keys**. You pay the AI
companies directly for what you use; AI Hub itself has no subscription and no account.

## 1. Install

1. Run **AI-Hub-Setup-x.y.z.exe**.
2. Windows will probably show a blue *"Windows protected your PC"* screen — this is expected,
   see [Windows SmartScreen warning](#windows-smartscreen-warning) below.
3. Choose the install folder and finish. Start **AI Hub** from the Start menu or desktop.

### Windows SmartScreen warning

When you run the installer, Windows may show a blue window:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.

This appears because the installer is **not digitally code-signed** (code-signing
certificates are expensive for small developers) and is not yet downloaded by many people. It
does not mean a virus was found.

To continue:

1. Click the small **More info** link under the message.
2. The window now shows *App: AI-Hub-Setup-x.y.z.exe* and a **Run anyway** button.
3. Click **Run anyway**. The installer starts normally.

You only need to do this once per installer. Only do it for an installer you downloaded from
the seller's official link.

Your browser may also warn while downloading (for example Microsoft Edge: *"…isn't commonly
downloaded"*). Click **⋯ → Keep → Show more → Keep anyway**. In Chrome click **Keep**.

## 2. Activate

On first launch, paste the **license key** you received after purchase (it starts with
`AIHUB1.`) and click **Activate**. Activation works offline. You can see your license under
**Settings → About**.

### Setup wizard

Right after activation, a short **setup wizard** opens: a welcome page, a page to add your API
keys (with **Get a key** links to each provider), and a page to **Test** every key. Click
**Start using AI Hub** when you're done, or **Skip setup** to do it later. You can run it again
from **Settings → General → Run the setup wizard again**.

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
| **xAI Grok** | https://console.x.ai | Chat and images; video is in **Beta**. |
| **OpenRouter** | https://openrouter.ai/keys | One key for hundreds of models. Refreshing its model list also fills in prices for cost estimates. |
| **Groq** | https://console.groq.com/keys | Very fast open models, free tier; also Whisper speech-to-text. |
| **DeepSeek** | https://platform.deepseek.com/api_keys | Low-cost chat and reasoning models. |
| **Mistral AI** | https://console.mistral.ai/api-keys | Mistral Large/Medium/Small and Codestral. |
| **Stability AI** | https://platform.stability.ai/account/keys | Image generation, image-to-image and upscaling (Beta). |
| **Ollama (local)** | https://ollama.com/download | **No key.** Install Ollama, download a model (e.g. `ollama pull llama3.2`), then click **Test connection** in Settings. Free and private. |
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
- **📎** attaches images (for models that can see images), documents (**PDF, DOCX**) or
  text/code files (**TXT**, code…). You can also drag & drop or paste. The text of documents
  is read on your PC and sent with your message; each attachment shows its size in tokens
  (pages for PDFs). Scanned PDFs (images only) contain no text — attach them as images
  instead. Old `.doc` files: save as `.docx` first.
- If attachments are too big for the selected model, a yellow warning appears — remove some
  files or pick a model with a larger context window. Very long files are cut and marked
  **truncated**.
- **✨ Enhance** rewrites a short prompt into a detailed one using your chat model. Click
  **Undo** to get your original text back.
- Under each answer you see the tokens used and an **approximate cost** (≈ $0.0012). "≈" in
  front of the tokens means the provider didn't report them and AI Hub estimated them.
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
aspect ratio and number of images, then **Generate**. **✨ Enhance** turns a short idea into a
detailed image prompt.

**Image tools:**
- **Reference image** — click the layers icon on a gallery image (**Use as reference**) or
  **Upload reference image**, describe the change, and generate. Supported by OpenAI GPT Image,
  Gemini 2.5 Flash Image and Stability AI (SD 3.5; Stable Image Ultra is Beta). **Change
  strength** controls how far the result may move away from the reference (Stability).
- **Upscale** (expand icon) — makes a larger, sharper copy (Stability AI, Beta).
- **Variations** (columns icon) — creates two variations of an image (OpenAI DALL·E 2; the
  image must be square). Results are labelled *From reference*, *Upscaled* or *Variation*.
 Images are saved automatically to your
output folder (default `Documents\AI Hub\images`) with a `.json` file describing the prompt.
Click an image to view it large; use the buttons to copy, show in folder, save a copy, reuse
the prompt or delete.

### Audio
- **Text to speech**: choose provider, model and voice (ElevenLabs: click 🔄 to load your own
  voices), type text and click **Generate speech**. Play it, **Save MP3**, or delete it.
- **Speech to text**: **Upload audio file** or **Record from microphone** (allow microphone
  access if Windows asks), optionally set a language code like `en`, then **Transcribe**.

### Video
Write a prompt (or a short idea + **✨ Enhance**), optionally choose a start image, size and
duration, then **Create video**.
Features marked **Beta** (xAI video, and starting a Veo video from an image) are new and may
not work yet with every account.
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
- **General** — theme, **language** (English or **اردو Urdu**, with a right-to-left layout),
  output folder, default temperature/max tokens, logs folder, and **Run the setup wizard
  again**.
- **Defaults** — also lets you choose the **Prompt enhancer** model.
- **Usage** — **estimated cost by month** per provider (click a provider to see each model),
  plus all-time requests, tokens, images, audio and videos. Counted on your PC only; your
  provider's bill is the real amount.
- **Prices** — the price table used for cost estimates, in US dollars per 1 million tokens
  (input and output). The defaults are approximate; check your provider's pricing page and
  edit them. **Model** can be an exact name, a prefix ending in `*` (e.g. `gpt-4o*`) or `*` for
  every model of that provider. Models without a price show "no price" and an asterisk.
- **Backup** — export settings, conversations, prompts and usage to one file, and import it on
  another PC. Tick **Include API keys (encrypted)** to also back up your keys: you must choose
  a **passphrase** (at least 8 characters, typed twice). The keys are encrypted with it; when
  you import the file, AI Hub asks for the passphrase. A wrong passphrase imports nothing —
  try again, or choose **Import without keys**. AI Hub does not store the passphrase: if you
  forget it, the keys in that file are lost (everything else can still be imported). The
  file still contains your keys, so keep it private.
- **About** — version, license and data folder.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **Ctrl+N** | New chat (on the Code screen: new code chat) |
| **Enter** / **Shift+Enter** | Send / new line |
| **Esc** | Stop the answer being generated (or close a dialog) |
| **Ctrl+L** | Jump to the message box |
| **Ctrl+1 … Ctrl+8** | Chat, Images, Video, Audio, Code, History, Prompts, Settings |
| **Ctrl+,** | Settings |
| **Ctrl+/** or **F1** | Show all shortcuts |

Click **Keyboard shortcuts** in the sidebar to see this list in the app. Shortcuts also work
with an Urdu keyboard layout.

## 5. Troubleshooting

| Message | What to do |
| --- | --- |
| **Invalid API key** | Copy the key again (no spaces), or create a new one on the provider website, then **Replace key**. |
| **No balance or quota left** | Add credit / enable billing on the provider's website. |
| **Rate limited** | AI Hub already retried automatically. Wait a minute and try again, or use a cheaper/faster model. |
| **Network problem** / offline banner | Check your internet, VPN, proxy or firewall. Corporate networks may block AI services. |
| **Could not reach Ollama** | Start the Ollama app (or run `ollama serve`), make sure you downloaded a model (`ollama pull llama3.2`), then click **Test connection**. |
| **Attachment too large** | Remove some files, or choose a model with a bigger context (e.g. Gemini 2.5, GPT-4.1). |
| **No text found in this PDF** | It is a scanned document. Attach it as an image instead, or use a PDF with selectable text. |
| **Model not found** | The model was renamed or your account has no access. Click 🔄 to refresh models and pick another one. |
| **Blocked by content policy** | The provider refused the request. Rephrase the prompt. |
| Key shows **Not tested** | The test could not reach the provider; check your connection and click **Test key**. |
| Microphone does not record | Windows Settings → Privacy & security → Microphone → allow desktop apps. |
| Backup: **Wrong passphrase** | Type the passphrase used when the backup was exported (it is case-sensitive). If it is lost, use **Import without keys** and re-enter your keys in Settings. |
| Video stays "Generating" a long time | Normal for some providers (up to several minutes). If it failed, click **Check again**. |

Click **Details** on any error to see the provider's raw message (keys are always removed).

**Logs**: Settings → General → **Open logs folder**. Logs never contain your API keys. Include
`app.log` when you contact support.

**Where is my data?**
- Settings, history and encrypted keys: `%APPDATA%\AI Hub\`
- Generated files: `Documents\AI Hub\` (change in Settings → General)

**Uninstall**: Windows Settings → Apps → AI Hub → Uninstall. Your data folders are kept; delete
them manually if you want to remove everything.
