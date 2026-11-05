// Builds public and private image variants for every case study.
//
// Reads  ../case-studies/<slug>/images.json  (kept outside the site so client names never enter the repo)
// Writes public/img/<slug>/<id>.webp        public variant (blurred unless marked "clear")
//        public/vault/<slug>/<id>.bin       private variant, AES-256-GCM encrypted
//        public/vault/<slug>/text.bin       private text strings, encrypted
//        public/vault/meta.json             salt, iterations and a check token for the unlock form
//        src/data/<slug>.json               ids, sizes, alt text and public text only
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto as crypto } from "node:crypto";
import sharp from "sharp";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STUDIES = path.resolve(SITE, "../case-studies");

// NDA blur floor. The manifest's blur values were tuned for wide desktop captures; on phone captures and
// tall text-heavy pages the type is large relative to the blur, and client and brand names stayed readable.
// The public variant gets at least this much blur, whatever the manifest says.
const STRONGER = {
  // Voice captures: brand and project names sit in the brief fields
  "portal/v-entry": 14, "portal/v-ready": 14, "portal/v-listen": 14, "portal/v-ask": 14, "portal/v-review": 14, "portal/v-split": 18,
  // Public marketing pages for families: large headline type
  "edu/landing": 18,
};
function blurFor(slug, spec, w, h) {
  let sigma = spec.blur ?? 5;
  if (h > w) sigma = Math.max(sigma, 18);              // portrait: phone screens
  else if (w < 1000) sigma = Math.max(sigma, 14);      // small captures keep their native size
  if (h > w * 1.3) sigma = Math.max(sigma, 16);        // tall pages, mostly marketing type
  if (/^g-(land|faq)/.test(spec.id)) sigma = Math.max(sigma, 16);
  return Math.max(sigma, STRONGER[`${slug}/${spec.id}`] ?? 0);
}
const ITERATIONS = 600_000;
const PUBLIC_WIDTH = 1200;
const PRIVATE_WIDTH = 1920;

async function passphrase() {
  const env = path.resolve(SITE, "../.env");
  if (existsSync(env)) {
    const m = (await readFile(env, "utf8")).match(/^PORTFOLIO_PASSPHRASE=(.+)$/m);
    if (m) return { value: m[1].trim().replace(/^"|"$/g, ""), demo: false };
  }
  console.warn("! PORTFOLIO_PASSPHRASE not set in portfolio/.env, using the demo passphrase \"demo\" (local preview only)");
  return { value: "demo", demo: true };
}

async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
}

async function encrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

// Finds the bounding box of saturated red pixels (client logos) in the header band.
async function redLogoBox(img, band = 110) {
  const { data, info } = await img.clone().extract({ left: 0, top: 0, width: (await img.metadata()).width, height: band }).raw().toBuffer({ resolveWithObject: true });
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 110 && r - g > 55 && r - b > 45) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : [x0 - 12, y0 - 12, x1 + 12, y1 + 14];
}

function maskSvg(w, h, boxes) {
  const rects = boxes.map(([a, b, c, d]) => `<rect x="${Math.max(0, a)}" y="${Math.max(0, b)}" width="${c - a}" height="${d - b}" rx="6" fill="#E3E6EC"/>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`);
}

async function render(root, spec, defaults) {
  let img = sharp(path.join(root, spec.src)).flatten({ background: "#ffffff" });
  if (spec.crop) {
    const [x, y, w, h] = spec.crop;
    img = sharp(await img.extract({ left: x, top: y, width: w, height: h }).png().toBuffer());
  }
  const meta = await img.metadata();
  const boxes = [...(spec.masks ?? defaults.masks ?? [])];
  if (spec.autoMaskRed ?? defaults.autoMaskRed) {
    const box = await redLogoBox(img);
    if (box) boxes.push(box);
  }
  if (boxes.length) img = sharp(await img.composite([{ input: maskSvg(meta.width, meta.height, boxes), top: 0, left: 0 }]).png().toBuffer());
  if (spec.padTo) {
    const [w, h, bg] = spec.padTo;
    img = sharp(await img.extend({ right: Math.max(0, w - meta.width), bottom: Math.max(0, h - meta.height), background: bg }).png().toBuffer());
  }
  return img;
}

async function main() {
  const pass = await passphrase();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass.value, salt);
  await rm(path.join(SITE, "public/img"), { recursive: true, force: true });
  await rm(path.join(SITE, "public/vault"), { recursive: true, force: true });
  await mkdir(path.join(SITE, "public/vault"), { recursive: true });
  await mkdir(path.join(SITE, "src/data"), { recursive: true });

  const check = await encrypt(key, new TextEncoder().encode("unlocked"));
  await writeFile(path.join(SITE, "public/vault/meta.json"), JSON.stringify({
    salt: Buffer.from(salt).toString("base64"), iterations: ITERATIONS, check: Buffer.from(check).toString("base64"), demo: pass.demo,
  }));
  await writeFile(path.join(SITE, ".passphrase-status"), pass.demo ? "demo" : "set");

  for (const dir of await readdir(STUDIES)) {
    const manifestPath = path.join(STUDIES, dir, "images.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const root = path.resolve(STUDIES, dir, manifest.root);
    const slug = manifest.public_slug ?? dir;   // folder names can hint at the client; the site uses neutral ones
    const pubDir = path.join(SITE, "public/img", slug);
    const vaultDir = path.join(SITE, "public/vault", slug);
    await mkdir(pubDir, { recursive: true });
    await mkdir(vaultDir, { recursive: true });
    const data = { images: {}, text: manifest.public_text || {} };

    for (const spec of manifest.images) {
      const mode = spec.public ?? manifest.defaults.public;
      const base = await render(root, spec, manifest.defaults);
      const full = await base.clone().resize({ width: PRIVATE_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      let pub = base.clone().resize({ width: PUBLIC_WIDTH, withoutEnlargement: true });
      if (mode === "blur") pub = pub.blur(blurFor(slug, spec, full.info.width, full.info.height));
      const pubOut = await pub.webp({ quality: mode === "blur" ? 60 : 82 }).toBuffer();
      await writeFile(path.join(pubDir, `${spec.id}.webp`), pubOut);
      if (mode !== "clear") await writeFile(path.join(vaultDir, `${spec.id}.bin`), await encrypt(key, full.data));
      if (process.env.DEBUG_PRIVATE_DIR) await writeFile(path.join(process.env.DEBUG_PRIVATE_DIR, `${slug}-${spec.id}.webp`), full.data);
      data.images[spec.id] = { w: full.info.width, h: full.info.height, alt: spec.alt, public: mode };
      console.log(`  ${slug}/${spec.id}  ${full.info.width}x${full.info.height}  ${mode}`);
    }
    for (const v of manifest.videos || []) {
      const bytes = await readFile(path.join(root, v.src));
      await writeFile(path.join(vaultDir, `${v.id}.bin`), await encrypt(key, bytes));
      const meta = v.meta ? JSON.parse(await readFile(path.join(root, v.meta), "utf8")) : {};
      (data.videos ??= {})[v.id] = { poster: v.poster, chapters: meta.chapters || [], duration: meta.duration || 0 };
      console.log(`  ${slug}/${v.id}  video ${(bytes.length / 1e6).toFixed(1)} MB  encrypted`);
    }
    if (manifest.private_text) {
      await writeFile(path.join(vaultDir, "text.bin"), await encrypt(key, new TextEncoder().encode(JSON.stringify(manifest.private_text))));
    }
    await writeFile(path.join(SITE, "src/data", `${slug}.json`), JSON.stringify(data, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
