import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const manifest = JSON.parse(
  readFileSync(join(root, "extension", "manifest.json"), "utf8")
);
const version = manifest.version;

const extensionId =
  process.env.EXTENSION_ID ?? "kokcmkomlkjlolnoklgikcmkehdjedim";
const hostRepo = (
  process.env.UPDATE_HOST_REPOSITORY?.trim() ||
  process.env.GITHUB_REPOSITORY ||
  ""
).trim();
if (!hostRepo) {
  console.error(
    "Set UPDATE_HOST_REPOSITORY to owner/repo, or run in GitHub Actions."
  );
  process.exit(1);
}
const branch = process.env.UPDATE_BRANCH ?? "main";
const crxName = process.env.CRX_FILENAME ?? "TextFree-Mark-Unread.crx";

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
