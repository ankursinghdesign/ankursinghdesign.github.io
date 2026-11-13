// Site-wide behaviour: reveal on scroll, before/after sliders,
// and the private view (decrypts NDA images and text in the browser).

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function toast(msg: string) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout((t as any)._t);
  (t as any)._t = setTimeout(() => t.classList.remove("on"), 1800);
}

// Reveal on scroll
const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}), { threshold: 0.15 });
$$(".reveal").forEach(el => io.observe(el));

// Before/after sliders
$$(".compare").forEach(c => {
  const range = $<HTMLInputElement>("input[type=range]", c);
  const set = (v: number) => c.style.setProperty("--pos", `${v}%`);
  range?.addEventListener("input", () => set(+range.value));
  if (!reduceMotion) {
    const once = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || !range) return;
      once.disconnect();
      let t0 = 0;
      const step = (t: number) => {
        t0 ||= t;
        const p = Math.min((t - t0) / 1400, 1), v = 50 + Math.sin(p * Math.PI * 2) * 22 * (1 - p);
        range.value = String(v); set(v);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
    once.observe(c);
  }
});

// Annotation hotspots: tap or hover shows the note; Escape closes
$$(".spot").forEach(s => {
  s.addEventListener("click", () => {
    const open = s.getAttribute("aria-expanded") === "true";
    $$(".spot[aria-expanded=true]").forEach(o => o.setAttribute("aria-expanded", "false"));
    s.setAttribute("aria-expanded", String(!open));
  });
});
addEventListener("keydown", e => { if (e.key === "Escape") $$(".spot[aria-expanded=true]").forEach(o => o.setAttribute("aria-expanded", "false")); });

// Private view
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const KEY_STORE = "pv-key";
let vaultKey: CryptoKey | null = null;

async function deriveKey(pass: string) {
  const meta = await (await fetch("/vault/meta.json", { cache: "no-store" })).json();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(meta.salt), iterations: meta.iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  await decrypt(key, b64(meta.check)); // throws on a wrong passphrase
  return key;
}

async function decrypt(key: CryptoKey, bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}

async function applyPrivate(key: CryptoKey) {
  document.documentElement.classList.add("private");
  const texts = new Map<string, Record<string, string>>();
  for (const el of $$("[data-ptext]")) {
    const [slug, field] = el.dataset.ptext!.split(":");
    if (!texts.has(slug)) {
      const res = await fetch(`/vault/${slug}/text.bin`);
      texts.set(slug, res.ok ? JSON.parse(new TextDecoder().decode(await decrypt(key, new Uint8Array(await res.arrayBuffer())))) : {});
    }
    const value = texts.get(slug)![field];
    if (value) { el.dataset.publicText ??= el.textContent ?? ""; el.textContent = value; }
  }
  await Promise.all($$<HTMLImageElement>("img[data-vault]").map(async img => {
    const res = await fetch(`/vault/${img.dataset.vault}.bin`);
    if (!res.ok) return;
    const url = URL.createObjectURL(new Blob([await decrypt(key, new Uint8Array(await res.arrayBuffer()))], { type: "image/webp" }));
    img.dataset.publicSrc ??= img.src;
    img.src = url;
    img.closest("figure")?.classList.add("unlocked");
  }));
  const btn = $("#lockBtn");
  btn?.setAttribute("aria-pressed", "true");
  const lbl = $(".lbl", btn!); if (lbl) lbl.textContent = "Unlocked";
  btn?.classList.remove("pop"); void btn?.offsetWidth; btn?.classList.add("pop");
  announce();
}

function lock() {
  document.documentElement.classList.remove("private");
  sessionStorage.removeItem(KEY_STORE);
  vaultKey = null;
  $$<HTMLImageElement>("img[data-public-src]").forEach(img => { URL.revokeObjectURL(img.src); img.src = img.dataset.publicSrc!; delete img.dataset.publicSrc; img.closest("figure")?.classList.remove("unlocked"); });
  $$("[data-public-text]").forEach(el => { el.textContent = el.dataset.publicText!; delete el.dataset.publicText; });
  const btn = $("#lockBtn");
  btn?.setAttribute("aria-pressed", "false");
  const lbl = $(".lbl", btn!); if (lbl) lbl.textContent = "Private view";
  toast("Private view locked");
  announce();
}

// Other components (videos) fetch and decrypt vault files through this, and listen for "vault:change".
(window as any).__vault = {
  get unlocked() { return !!vaultKey; },
  async fetch(file: string) {
    if (!vaultKey) throw new Error("locked");
    const res = await fetch(`/vault/${file}`);
    return decrypt(vaultKey, new Uint8Array(await res.arrayBuffer()));
  },
};
const announce = () => document.dispatchEvent(new CustomEvent("vault:change", { detail: { unlocked: !!vaultKey } }));

const dlg = $<HTMLDialogElement>("#unlockDlg");
$("#lockBtn")?.addEventListener("click", () => {
  if (vaultKey) return lock();
  $("#unlockErr")!.textContent = "";
  dlg?.showModal();
  $<HTMLInputElement>("#pass")?.focus();
});
$("#unlockCancel")?.addEventListener("click", () => dlg?.close());
$("#unlockForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const input = $<HTMLInputElement>("#pass")!, go = $<HTMLButtonElement>("#unlockGo")!;
  go.disabled = true; go.textContent = "Checking…";
  try {
    vaultKey = await deriveKey(input.value);
    sessionStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey)))));
    input.value = "";
    dlg?.close();
    await applyPrivate(vaultKey);
    toast("Private view unlocked");
    track("private_view_unlock", { method: "passphrase" });
  } catch {
    $("#unlockErr")!.textContent = "That passphrase didn't work.";
    dlg?.classList.remove("shake"); void dlg?.offsetWidth; dlg?.classList.add("shake");
  } finally {
    go.disabled = false; go.textContent = "Unlock";
  }
});

// Stay unlocked across pages in the same tab, or unlock from a résumé's one-click link
// (Base.astro moves the #pv= passphrase from the address bar into sessionStorage before anything else runs).
(async () => {
  const linkPass = sessionStorage.getItem("pv-pass");
  sessionStorage.removeItem("pv-pass");
  if (linkPass && !sessionStorage.getItem(KEY_STORE)) {
    try {
      vaultKey = await deriveKey(linkPass);
      sessionStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey)))));
      await applyPrivate(vaultKey);
      toast("Private view unlocked");
      track("private_view_unlock", { method: "link" });
    } catch { vaultKey = null; } // an old passphrase: the page stays public and the button still works
    return;
  }
  const saved = sessionStorage.getItem(KEY_STORE);
  if (!saved) return;
  try {
    vaultKey = await crypto.subtle.importKey("raw", b64(saved), "AES-GCM", true, ["decrypt"]);
    await applyPrivate(vaultKey);
  } catch { sessionStorage.removeItem(KEY_STORE); }
})();

// Analytics (only active when GA_ID is set in site-config.ts; events wait in memory until the visitor accepts)
function track(name: string, params: Record<string, string> = {}) { (window as any).__track?.(name, params); }
document.addEventListener("click", e => {
  const a = (e.target as Element).closest?.("a");
  if (!a) return;
  const href = a.getAttribute("href") || "";
  if (/\.pdf($|\?)/i.test(href)) track("resume_download", { file: href });
  else if (href.startsWith("mailto:")) track("contact_click", { type: "email" });
  else if (href.includes("linkedin.com")) track("contact_click", { type: "linkedin" });
});
const consent = $("#consent");
if (consent) {
  let choice: string | null = null;
  try { choice = localStorage.getItem("analytics-consent"); } catch {}
  if (!choice) consent.hidden = false;
  consent.addEventListener("click", e => {
    const v = (e.target as Element).closest<HTMLElement>("[data-consent]")?.dataset.consent;
    if (!v) return;
    try { localStorage.setItem("analytics-consent", v); } catch {}
    consent.hidden = true;
    if (v === "yes") (window as any).__loadGA?.();
  });
}

// Light / dark theme toggle. With no saved choice, the system setting decides.
const themeBtn = $<HTMLButtonElement>("#themeBtn");
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light")) === "dark";
const syncTheme = () => {
  const dark = isDark();
  document.documentElement.classList.toggle("is-dark", dark);
  themeBtn?.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
};
themeBtn?.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
  syncTheme();
});
systemDark.addEventListener("change", syncTheme);
syncTheme();
