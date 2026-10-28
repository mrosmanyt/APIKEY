# License setup (for the seller)

This guide is for **you, the seller**. You do this once on your own Windows PC. It creates
the secret key that signs license keys for your buyers. No programming knowledge needed.

> **Why on your own PC?** The *private key* created here is what makes license keys valid.
> Whoever has it can create unlimited licenses. It must only ever exist on computers you
> control — never in GitHub, never in email, never in a chat.

Time needed: about 15 minutes.

---

## Step 1 — Install Node.js

1. Go to <https://nodejs.org> and download the **LTS** version for Windows (the `.msi` file).
2. Run it and click **Next** through the installer (the defaults are fine).
3. Check it worked: press the **Windows key**, type `cmd`, press **Enter**. In the black
   window type:

   ```bat
   node -v
   ```

   You should see something like `v22.x.x`. (Any version 20 or newer is fine.)

That's the only program the license tools need — you do **not** need to run `npm install`.

## Step 2 — Get the AI Hub code onto your PC

The easiest way is **GitHub Desktop**:

1. Install it from <https://desktop.github.com> and sign in with your GitHub account.
2. **File → Clone repository…** → pick **mrosmanyt/APIKEY** → choose a local folder,
   for example `C:\AIHub` → **Clone**.
3. Make sure the current branch (top bar) is **main**. (If the pull request with these
   instructions isn't merged yet, merge it on GitHub first, then **Fetch origin / Pull**.)

## Step 3 — Create your keypair (once, ever)

1. Open a Command Prompt in the folder: press the **Windows key**, type `cmd`, press **Enter**,
   then type `cd C:\AIHub` and press **Enter**. (GitHub Desktop's **Repository → Open in
   Command Prompt / PowerShell** does the same.)
2. Run:

   ```bat
   npm run license:keypair
   ```

   > If you see *"running scripts is disabled on this system"*, you are in PowerShell —
   > use **Command Prompt** (`cmd`) instead, or run `node tools\generate-keypair.mjs`.

3. You'll see **"Done! Your license keypair was created."** Two things happened:

   | What | Where | What to do |
   | --- | --- | --- |
   | **Private key** (secret) | `C:\AIHub\keys\license-private.pem` | **Back it up (Step 5). Never commit, upload or send it.** |
   | **Public key** (safe to share) | `C:\AIHub\src\main\license\publicKey.ts` | **Commit and push it (Step 4).** |

   The tool refuses to run a second time so you can't overwrite your key by accident.

## Step 4 — Commit the public key

1. Go back to **GitHub Desktop**. On the left you should see exactly **one** changed file:
   `src/main/license/publicKey.ts`.
   - The `keys` folder does **not** appear — it is ignored on purpose so your private key
     can never be uploaded. If you ever see `license-private.pem` in the list, **stop** and
     don't commit.
2. Bottom left: type a summary such as `Add my license public key` → **Commit to main** →
   **Push origin**.

From now on every installer you build contains your public key, and only license keys
signed with your private key will be accepted.

## Step 5 — Back up the private key

Copy `C:\AIHub\keys\license-private.pem` to **at least two** safe places, for example:

- a USB stick you keep at home, **and**
- a password manager (Bitwarden, 1Password, KeePass…) as an attachment or secure note
  (it is a small text file — you can paste its content).

Also back up `C:\AIHub\keys\issued-licenses.csv` from time to time (your list of sold licenses).

**If you lose the private key**, you cannot create new licenses that the current app accepts.
You would have to run `npm run license:keypair -- --force`, commit the new public key,
publish a new version and send new license keys to all buyers. So: back it up!

**Using another PC later?** Clone the repository there and copy your `keys` folder back into
it (e.g. `D:\AIHub\keys\license-private.pem`). Don't run the keypair command again.

## Step 6 — Publish an installer

1. On GitHub open the repository → `package.json` → check the `"version"` (e.g. `1.0.0`).
   Change it if this is a new version and commit.
2. In GitHub Desktop: **History** tab → right-click the newest commit → **Create Tag…** →
   type `v1.0.0` (a `v` + exactly the version from `package.json`) → **Create Tag** →
   **Push origin** (it pushes the tag).
3. On GitHub open **Actions** and wait for the *Build* run (≈10 minutes). When it is green,
   open **Releases**: the release **AI Hub v1.0.0** has `AI-Hub-Setup-1.0.0.exe` attached.
   Release files don't expire.

The release build stops with a clear error if you forgot Step 4 (placeholder key still in the
app) or if the tag doesn't match the version in `package.json`.

## Step 7 — Create a license key for each buyer

1. Open Command Prompt in `C:\AIHub` (as in Step 3) and run:

   ```bat
   npm run license:generate
   ```

2. Answer the questions (only the name is required):

   ```
   Buyer name: Jane Doe
   Buyer email (optional): jane@example.com
   Order / license ID (optional): ORDER-1001
   Expiry date YYYY-MM-DD (optional, Enter = never):
   ```

3. It prints a long line starting with `AIHUB1.` — that's the license key. Copy the **whole**
   line and send it to the buyer (for example in the purchase confirmation email). The buyer
   pastes it into AI Hub on first launch.

Each license is also recorded in `C:\AIHub\keys\issued-licenses.csv` (open it with Excel).

(In PowerShell, if `npm` is blocked, use `node tools\generate-license.mjs` instead.)

Prefer one command? This does the same without questions:

```bat
npm run license:generate -- --name "Jane Doe" --email jane@example.com --id ORDER-1001
```

If you see **"WARNING: this key does NOT match the public key"**, the private key you are
using is not the one whose public key is in the app — check you are in the right folder and
that you committed `publicKey.ts` from Step 4.

## Quick reference

| Task | Command (in `C:\AIHub`) |
| --- | --- |
| Create keypair (once) | `npm run license:keypair` |
| Create a buyer license | `npm run license:generate` |
| Check the app has your key (not the placeholder) | `npm run license:check` |
