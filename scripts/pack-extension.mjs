import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ChromeExtension from "crx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const extRoot = join(root, "extension");

const keyPath = process.env.CRX_PRIVATE_KEY_PATH;
if (!keyPath) {
  console.error("Set CRX_PRIVATE_KEY_PATH to your .pem file.");
  process.exit(1);
}

const crxName = process.env.CRX_FILENAME ?? "TextFree-Mark-Unread.crx";
const outPath = join(root, crxName);

const names = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "inject-main.js",
];

function posixPath(p) {
  return p.replace(/\\/g, "/");
}

const files = names.map((n) => posixPath(join(extRoot, n)));

const privateKey = readFileSync(keyPath);
const crx = new ChromeExtension({ privateKey, version: 3 });

await crx.load(files);
const buffer = await crx.pack();
writeFileSync(outPath, buffer);
console.log(`Packed ${outPath}`);
