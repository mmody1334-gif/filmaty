// Regenerate src/player/webapp-html.ts from index.html so the two copies
// of the WebApp can never drift apart. index.html is the single source
// of truth; run via `npm run build:webapp` (also runs first in typecheck).
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
writeFileSync(
  "src/player/webapp-html.ts",
  `export const FILMATY_WEBAPP_HTML = ${JSON.stringify(html)};\n`,
);
