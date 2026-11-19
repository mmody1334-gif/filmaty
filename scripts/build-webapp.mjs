// Regenerate src/player/webapp-html.ts from index.html, sw.js, and manifest.json
// so Worker-served and static copies stay identical; run via `npm run build:webapp`.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const sw = readFileSync("sw.js", "utf8");
const manifest = readFileSync("manifest.json", "utf8");
writeFileSync(
  "src/player/webapp-html.ts",
  `export const FILMATY_WEBAPP_HTML = ${JSON.stringify(html)};\n` +
    `export const FILMATY_SW_JS = ${JSON.stringify(sw)};\n` +
    `export const FILMATY_MANIFEST_JSON = ${JSON.stringify(manifest)};\n`,
);
