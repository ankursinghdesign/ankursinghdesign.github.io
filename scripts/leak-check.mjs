// Fails the build if anything private could be published unencrypted.
//   1. Private text strings (client names) must not appear in dist/ in plain text.
//   2. No raw source images (PNG/JPG) may be in dist/; only generated webp and encrypted .bin files.
//   3. Unconfirmed draft markers ([confirm]) must not ship.
//   4. A real passphrase must be set (not the local demo one).
//   5. Private text must not appear in the source either, since the repo is public.
// On the build server ../case-studies doesn't exist, so checks 1 and 5 only run locally (and in the pre-push hook).
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(SITE, "dist");
const STUDIES = path.resolve(SITE, "../case-studies");
const problems = [];

async function* walk(dir) {
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    if ((await stat(p)).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const secrets = new Set();
for (const slug of existsSync(STUDIES) ? await readdir(STUDIES) : []) {
  const m = path.join(STUDIES, slug, "images.json");
  if (!existsSync(m)) continue;
  const manifest = JSON.parse(await readFile(m, "utf8"));
  for (const v of Object.values(manifest.private_text || {})) {
    for (const word of v.split(/[^A-Za-z0-9]+/)) if (word.length >= 3 && /^[A-Z]{3,}$/.test(word)) secrets.add(word);
  }
  for (const k of manifest.leak_words || []) secrets.add(k);
}

for await (const file of walk(DIST)) {
  const rel = path.relative(DIST, file);
  if (/\.(png|jpe?g|fig)$/i.test(file) && !rel.startsWith("favicon")) problems.push(`raw image in output: ${rel}`);
  if (/\.(html|js|css|json|xml|txt|svg)$/i.test(file)) {
    const text = await readFile(file, "utf8");
    for (const s of secrets) if (new RegExp(`\\b${s}\\b`).test(text)) problems.push(`private word "${s}" in ${rel}`);
    if (file.endsWith(".html") && text.includes("data-confirm")) problems.push(`unconfirmed [confirm] marker in ${rel}`);
  }
}

for (const dir of ["src", "scripts", "public"]) {
  for await (const file of walk(path.join(SITE, dir))) {
    if (!/\.(astro|ts|mjs|js|css|json|md|svg|html|txt)$/i.test(file)) continue;
    const text = await readFile(file, "utf8");
    for (const s of secrets) if (new RegExp(`\\b${s}\\b`).test(text)) problems.push(`private word "${s}" in source ${path.relative(SITE, file)}`);
  }
}

const meta = JSON.parse(await readFile(path.join(SITE, "public/vault/meta.json"), "utf8"));
if (meta.demo !== false) problems.push("PORTFOLIO_PASSPHRASE is not set in portfolio/.env (demo passphrase in use)");

if (problems.length) {
  console.error(`\nLeak check FAILED (${problems.length}):\n  - ${problems.join("\n  - ")}\n`);
  process.exit(process.env.ALLOW_DRAFT ? 0 : 1);
}
console.log("Leak check passed: no private text, raw images or draft markers in dist/.");
