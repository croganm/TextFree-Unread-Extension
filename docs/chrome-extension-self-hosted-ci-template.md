# Chrome extension: self-hosted `.crx` + `updates.xml` (GitHub Actions)

Use this checklist to give **another** Chrome extension the same workflow as this repo: sign a `.crx` with a **`.pem`** stored only in **GitHub Actions secrets**, regenerate **`updates.xml`** from **`manifest.json`**, and publish both artifacts for **anonymous** `raw.githubusercontent.com` URLs (Google Workspace / Admin “extension by ID + update URL”). **This repo uses a private source repo + public “dist” repo** so the extension source can stay private; you can instead use a single public repo and commit artifacts there if you prefer.

---

## 1. One-time values (fill in for each project)

| Placeholder | Example | Where it comes from |
|-------------|---------|---------------------|
| `OWNER` | `croganm` | GitHub username or org |
| `REPO` | `My-Extension` | Repository name |
| `MAIN_BRANCH` | `main` | Default branch (raw URLs must use this branch name, not a tag) |
| `EXTENSION_ID` | `abcdefghabcdefghabcdefghabcdefgh` | 32 characters, only `a`–`p`; derive from your signing key (same ID forever if you keep the same `.pem`). **Phonak Order Helper (this repo):** `kfbpmiojbcfpllbapphfipapcfkmgkki` — see §6. |
| `CRX_FILENAME` | `My-Extension.crx` | Filename you want on `raw.githubusercontent.com` (no spaces; match what you reference in Admin) |
| Source files | `manifest.json`, `*.js`, icons… | Everything that must **not** include `node_modules` or dev-only files |

---

## 1.5 Finding the packed extension ID (before publishing)

`EXTENSION_ID` must match the **public key derived from the private key** used to sign the `.crx` (the same key you store as `CRX_PRIVATE_KEY` in GitHub Actions). It does **not** match the ID Chrome shows for **Load unpacked**, and you should not depend on dragging the `.crx` onto `chrome://extensions` to read the ID (that install path often fails with `CRX_REQUIRED_PROOF_MISSING`).

**Recommended (same algorithm as the `crx` npm package / this repo’s pack script)**

1. In the extension project, run `npm ci` (or `npm install`) so `crx` is installed.
2. From the project root, run **one** of the following (use the path to **your** `.pem`; never commit the key).

   PowerShell (Windows):

   ```powershell
   node -e "const fs=require('fs');const ChromeExtension=require('crx');const crx=new ChromeExtension({privateKey:fs.readFileSync('C:/path/to/your/key.pem'),version:3});crx.generatePublicKey().then(pub=>console.log('Packed extension ID:',crx.generateAppId(pub)));"
   ```

   bash (macOS / Linux):

   ```bash
   node -e "const fs=require('fs');const ChromeExtension=require('crx');const crx=new ChromeExtension({privateKey:fs.readFileSync('/path/to/your/key.pem'),version:3});crx.generatePublicKey().then(pub=>console.log('Packed extension ID:',crx.generateAppId(pub)));"
   ```

3. Copy the printed **32-character** ID (letters **`a`–`p` only**). Use it for:
   - the `appid` in **`updates.xml`** (or your `generate-updates-xml` / `EXTENSION_ID` default),
   - **Google Admin** when you add the extension by ID + update URL,
   - optional **`EXTENSION_ID`** in GitHub Actions if you do not hard-code the default in the script.

**Chrome “Pack extension” (optional)**  
At `chrome://extensions` → **Pack extension**, you can point at the extension directory and your existing `.pem` to produce a `.crx`. Chrome does **not** always surface the packed ID in a convenient place in the UI; deriving the ID from the **same `.pem`** with the command above avoids ambiguity and matches what CI builds.

**If you rotate the key**  
A new `.pem` implies a **new** `EXTENSION_ID`. Update Admin, `updates.xml` / script defaults, and `CRX_PRIVATE_KEY` together.

---

## 2. Files to add (copy and replace placeholders)

### 2.1 `package.json`

```json
{
  "private": true,
  "scripts": {
    "generate-updates-xml": "node scripts/generate-updates-xml.mjs",
    "pack": "node scripts/pack-extension.mjs"
  },
  "devDependencies": {
    "crx": "^5.0.1"
  }
}
```

Run `npm install` and commit `package-lock.json`.

### 2.2 `scripts/generate-updates-xml.mjs`

- Use **`UPDATE_HOST_REPOSITORY`** for `raw.githubusercontent.com` URLs — the **public** repo that hosts the `.crx` (not the private source repo). CI sets it from a repository variable; locally: `UPDATE_HOST_REPOSITORY=owner/public-dist-repo`.

```javascript
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version;

const extensionId = process.env.EXTENSION_ID ?? "YOUR_EXTENSION_ID";
const hostRepo = (
  process.env.UPDATE_HOST_REPOSITORY?.trim() ||
  process.env.GITHUB_REPOSITORY ||
  ""
).trim();
if (!hostRepo) {
  console.error("Set UPDATE_HOST_REPOSITORY to owner/public-dist-repo.");
  process.exit(1);
}
const branch = process.env.UPDATE_BRANCH ?? "main";
const crxName = process.env.CRX_FILENAME ?? "YOUR_EXTENSION.crx";

const codebase = `https://raw.githubusercontent.com/${hostRepo}/${branch}/${crxName}`;

const xml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${codebase}' version='${version}'/>
  </app>
</gupdate>
`;

writeFileSync(join(root, "updates.xml"), xml, "utf8");
console.log(`updates.xml → version ${version}`);
```

### 2.3 `scripts/pack-extension.mjs`

**Important:** List **only** extension source files. Do **not** point `crx.load()` at the repo root with a directory glob, or `node_modules` can be packed.

Adjust `extensionSourceFiles()` for your layout (add icons, `background.js`, `_locales`, etc.):

```javascript
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ChromeExtension from "crx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const keyPath = process.env.CRX_PRIVATE_KEY_PATH;
if (!keyPath) {
  console.error("Set CRX_PRIVATE_KEY_PATH to your .pem file.");
  process.exit(1);
}

const crxName = process.env.CRX_FILENAME ?? "YOUR_EXTENSION.crx";
const outPath = join(root, crxName);

function extensionSourceFiles() {
  const dataDir = join(root, "data");
  const dataJs = existsSync(dataDir)
    ? readdirSync(dataDir)
        .filter((f) => f.endsWith(".js"))
        .map((f) => join(dataDir, f))
    : [];

  return [
    join(root, "manifest.json"),
    // Add every file your extension needs at runtime:
    join(root, "content.js"),
    // join(root, "background.js"),
    // join(root, "popup.html"),
    ...dataJs,
  ];
}

/** Required on Windows: the `crx` resolver only recognizes `manifest.json` when paths use `/`. */
function posixPath(p) {
  return p.replace(/\\/g, "/");
}

const privateKey = readFileSync(keyPath);
const crx = new ChromeExtension({ privateKey, version: 3 });

await crx.load(extensionSourceFiles().map(posixPath));
const buffer = await crx.pack();
writeFileSync(outPath, buffer);
console.log(`Packed ${outPath}`);
```

### 2.4 `.gitignore` (minimum)

```
node_modules/
*.pem
YOUR_EXTENSION.crx
updates.xml
```

Ignore the built artifacts in the **source** repo if you publish them only to a public dist repo.

### 2.5 `.github/workflows/release-extension.yml`

Copy the workflow from this repo and replace:

1. **`paths`** — list every path that should trigger a rebuild when changed (your extension sources, `scripts/`, workflow, `package.json`, `package-lock.json`). Do **not** list the `.crx` / `updates.xml` output paths if they only exist in the public repo.
2. **`UPDATE_HOST_REPOSITORY`** / **`PUBLIC_DIST_REPO`** — must match the **public** `owner/name` used in `updates.xml`.
3. **`UPDATE_BRANCH`** — keep `main` (or your public repo’s default branch) so `updates.xml` raw URLs stay correct.

The workflow in this repository: `npm ci` → write PEM from secrets → `npm run generate-updates-xml` → `node scripts/pack-extension.mjs` → **clone public dist repo, copy artifacts, commit, push** (using `PUBLIC_DIST_REPO_TOKEN`).

### 2.6 GitHub Actions variables and secrets

**Variables** (**Settings → Secrets and variables → Actions → Variables**)

| Variable | Purpose |
|----------|---------|
| `PUBLIC_DIST_REPO` | Public repo `owner/name` where `updates.xml` and the `.crx` are hosted |

**Secrets** (**Actions → Secrets**)

| Secret | Purpose |
|--------|---------|
| `CRX_PRIVATE_KEY` | Full PEM text (including `BEGIN` / `END` lines), **or** |
| `CRX_PRIVATE_KEY_B64` | Same PEM, base64-encoded (often easier; if both exist, prefer base64 in the workflow) |
| `PUBLIC_DIST_REPO_TOKEN` | PAT with **Contents: Read and write** on the **public dist** repo only |

Never commit the `.pem`.

Optional: set **`EXTENSION_ID`**, **`CRX_FILENAME`**, and **`UPDATE_BRANCH`** in the workflow `env` for `generate-updates-xml` / `pack-extension` if you do not want defaults inside the scripts.

---

## 3. Google Admin (reminder)

- **Extension ID:** `EXTENSION_ID`
- **Update URL:** use the **public dist** repo (not a private source repo):  
  `https://raw.githubusercontent.com/OWNER/PUBLIC_DIST_REPO/MAIN_BRANCH/updates.xml`  
- **`manifest.json` `version`** must match the `version` attribute in `updates.xml` for each release.

---

## 4. How to test that this will work

### 4.1 Local smoke test (before pushing CI)

If you do not know **`EXTENSION_ID`** yet, compute it from your `.pem` first (see **§1.5**), then use that value below or in your script default.

1. **Install deps:** `npm ci` (or `npm install`).
2. **Point at your key (never commit it):**  
   PowerShell (Windows):

   ```powershell
   $env:CRX_PRIVATE_KEY_PATH = "C:\path\to\your\key.pem"
   $env:CRX_FILENAME = "YOUR_EXTENSION.crx"
   $env:EXTENSION_ID = "your32charchromeextensionidhere"
   $env:UPDATE_HOST_REPOSITORY = "OWNER/PUBLIC_DIST_REPO"
   $env:UPDATE_BRANCH = "main"
   ```

   bash (macOS / Linux):

   ```bash
   export CRX_PRIVATE_KEY_PATH=/path/to/your/key.pem
   export CRX_FILENAME="YOUR_EXTENSION.crx"
   export EXTENSION_ID="your32charchromeextensionidhere"
   export UPDATE_HOST_REPOSITORY="OWNER/PUBLIC_DIST_REPO"
   export UPDATE_BRANCH="main"
   ```

3. **Generate XML and pack:**

   ```bash
   npm run generate-updates-xml
   node scripts/pack-extension.mjs
   ```

4. **Checks:**
   - Open **`updates.xml`**: `appid` must equal **`EXTENSION_ID`**; `version` must equal **`manifest.json` → `version`**; `codebase` must be the **raw** `https://raw.githubusercontent.com/OWNER/PUBLIC_DIST_REPO/main/YOUR_EXTENSION.crx` URL (not `/blob/`).
   - **Do not drag the `.crx` onto `chrome://extensions` to “test” the pack.** On current Chromium, that flow often validates the package like a Web Store download and fails with **`CRX_REQUIRED_PROOF_MISSING`** because only store-signed CRXs carry publisher proof. Your **self-hosted / Admin** install path is different: Chrome downloads the `.crx` via **`updates.xml`** under **enterprise policy** and verifies it as **`CRX3`** (developer key only). For local behavior testing, use **Load unpacked** on the extension folder; to confirm the **packed** artifact before rollout, use an **Admin test OU** (or policy) with your **Update URL**, or inspect the CRX with a CRX3 tool.

### 4.2 Verify the packed zip contents (no `node_modules`)

The `crx` file is a signed zip. Quick check:

- **7-Zip / Explorer:** Open `YOUR_EXTENSION.crx` as a zip if your tool allows, or rename to `.zip` temporarily and inspect — you should see **`manifest.json`** and your assets, and **no** `node_modules` folder.

### 4.3 After pushing to GitHub

1. Add **`CRX_PRIVATE_KEY`** or **`CRX_PRIVATE_KEY_B64`** to the repo secrets.
2. Run **Actions → Release extension → Run workflow** (manual run does not depend on `paths`).
3. Confirm a new commit on **`main`** that updates **`YOUR_EXTENSION.crx`** and **`updates.xml`** (or “no changes” if nothing differed).
4. **HTTP checks** (replace placeholders):

   ```text
   https://raw.githubusercontent.com/OWNER/PUBLIC_DIST_REPO/main/updates.xml
   https://raw.githubusercontent.com/OWNER/PUBLIC_DIST_REPO/main/YOUR_EXTENSION.crx
   ```

   Both should return **200** in a browser or with `curl -I`. The XML should be **raw XML**, not an HTML GitHub page.

### 4.4 End-to-end update check (optional)

On a **managed** test profile with the same **Extension ID** and **Update URL** as in Admin: bump **`manifest.json` `version`**, run the workflow, wait for Chrome’s update cycle (can take hours), or use `chrome://extensions` → **Update** (if available for your policy). For fastest feedback, rely on the HTTP + local pack checks first.

---

## 5. Common failures

| Symptom | Likely cause |
|---------|----------------|
| Wrong extension ID in Admin | ID must match the key used to sign the `.crx`, not an old unpacked folder. |
| Update never arrives | `version` in `updates.xml` not higher than installed; or **blob** URL instead of **raw**; or private repo without auth. |
| Huge `.crx` / wrong behavior | Packed **`node_modules`** or dev files — fix **`extensionSourceFiles()`** list. |
| Workflow fails on PEM | Multiline secret mangled — use **`CRX_PRIVATE_KEY_B64`**. |
| `updates.xml` points at a tag | Keep **`UPDATE_BRANCH=main`** (or your default branch), not `GITHUB_REF_NAME` from a tag. |
| `Unable to locate a manifest file in your list of files` (Windows) | The `crx` package expects `/` in paths — map file paths with **`p.replace(/\\/g, "/")`** before `crx.load()` (see `scripts/pack-extension.mjs` in this repo). |
| **`Package is invalid: CRX_REQUIRED_PROOF_MISSING`** when dragging the `.crx` onto `chrome://extensions` | **Expected** for developer-signed CRXs: that UI path expects Chrome Web Store publisher proof. It is **not** the same as the **Google Admin** install path. Use **Load unpacked** for local dev; deploy to users via **Admin** (extension ID + **Update URL** → `updates.xml`). Optionally allow **`ExtensionInstallSources`** for your raw GitHub CRX/XML hosts if your org uses additional off-store rules (see [Chrome Enterprise policies](https://chromeenterprise.google/policies/)). |

---

## 6. Relationship to this repository

This project implements the above with concrete names (`Phonak-Chrome-Extension-Order-Helper.crx`, real `paths`, etc.), **`PUBLIC_DIST_REPO`** variable, and **`PUBLIC_DIST_REPO_TOKEN`**. For a new extension, duplicate the structure and **search-replace** placeholders rather than copying Phonak-specific filenames blindly.

**Values for *this* extension (Phonak Order Helper):**

| Item | Value |
|------|--------|
| **Extension ID** | `kfbpmiojbcfpllbapphfipapcfkmgkki` — must match the `.pem` used in `CRX_PRIVATE_KEY` (or local `Phonak-Chrome-Extension-Order-Helper.pem`) when signing; also the `appid` in `updates.xml` and in Google Admin. |
| **Default in** `scripts/generate-updates-xml.mjs` | Same ID unless `EXTENSION_ID` is overridden in the environment. |
| **Packed filename** | `Phonak-Chrome-Extension-Order-Helper.crx` |

If you change the signing key, the extension ID changes; update Admin, `EXTENSION_ID` / script default, and any published `updates.xml` together.
