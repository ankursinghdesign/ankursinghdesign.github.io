// Home hero: screens from the case studies start scattered across the hero and assemble, once, into a calm grid.
// Cards use the public (blurred) images; in the private view they are re-drawn from the decrypted vault copies.
import * as THREE from "three";

const COLS = 6, ROWS = 5, W = 2.4, H = 1.5, GAP = .32;
const STAGGER = .17, FLIGHT = 3.4, LEAD = 1.1;          // seconds: between arrivals, per card, before the first

const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 3.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const outQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const inOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

function rounded(g: CanvasRenderingContext2D, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath();
}

function drawCard(img: CanvasImageSource & { width: number; height: number }) {
  const cw = 512, ch = 320, c = document.createElement("canvas"); c.width = cw; c.height = ch;
  const g = c.getContext("2d")!;
  rounded(g, cw, ch, 22); g.save(); g.clip();
  g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch);
  const s = Math.max(cw / img.width, ch / img.height);
  g.drawImage(img, 0, 0, img.width, img.height, 0, 0, img.width * s, img.height * s);
  g.restore(); rounded(g, cw - 1, ch - 1, 22); g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = 2; g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function heroCards(fx: HTMLElement, stage: HTMLElement, ids: string[]) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = () => innerWidth < 820;
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  fx.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 200);
  const group = new THREE.Group(); scene.add(group);

  const shadowCanvas = document.createElement("canvas"); shadowCanvas.width = 256; shadowCanvas.height = 192;
  const sg = shadowCanvas.getContext("2d")!; sg.filter = "blur(14px)"; sg.fillStyle = "#000"; sg.fillRect(36, 40, 184, 116);
  const shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false });
  const tone = () => { shadowMat.opacity = dark() ? .5 : .16; };
  tone(); matchMedia("(prefers-color-scheme: dark)").addEventListener("change", tone);

  const N = Math.min(ids.length, COLS * ROWS);
  // arrival order: a gentle wave from the far corner, slightly shuffled
  const order = [...Array(N).keys()].sort((a, b) =>
    ((a % COLS) + Math.floor(a / COLS) + rnd(a) * 2.5) - ((b % COLS) + Math.floor(b / COLS) + rnd(b) * 2.5));
  const plane = new THREE.PlaneGeometry(W, H), shadowPlane = new THREE.PlaneGeometry(W * 1.35, H * 1.5);
  type Card = { holder: THREE.Group; mat: THREE.MeshBasicMaterial; sh: THREE.Mesh; calm: THREE.Vector3; chaos: THREE.Vector3; rot: THREE.Euler; start: number };
  const cards: Card[] = [];
  for (let i = 0; i < N; i++) {
    const holder = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const sh = new THREE.Mesh(shadowPlane, shadowMat); sh.position.set(.08, -.16, -.12);
    holder.add(sh, new THREE.Mesh(plane, mat)); group.add(holder);
    const r = Math.floor(i / COLS), c = i % COLS;
    cards.push({
      holder, mat, sh,
      calm: new THREE.Vector3((c - (COLS - 1) / 2) * (W + GAP), ((ROWS - 1) / 2 - r) * (H + GAP), 0),
      chaos: new THREE.Vector3(),
      rot: new THREE.Euler((rnd(i + 1) - .5) * 2.6, (rnd(i + 2) - .5) * 2.8, (rnd(i + 5) - .5) * 1.8),
      start: 0,
    });
  }
  order.forEach((idx, k) => { cards[idx].start = LEAD + k * STAGGER; });

  function setImage(i: number, src: CanvasImageSource & { width: number; height: number }) {
    const old = cards[i].mat.map; cards[i].mat.map = drawCard(src); cards[i].mat.needsUpdate = true; old?.dispose();
  }
  const loads = ids.slice(0, N).map((id, i) => new Promise<void>(done => {
    const img = new Image(); img.decoding = "async";
    img.onload = () => { setImage(i, img); done(); }; img.onerror = () => done();
    img.src = `/img/${id}.webp`;
  }));

  // Private view: swap in the decrypted screens; locking again restores the blurred ones
  const vault = (window as any).__vault;
  async function sharpen(unlocked: boolean) {
    await Promise.all(ids.slice(0, N).map(async (id, i) => {
      try {
        if (unlocked) setImage(i, await createImageBitmap(new Blob([await vault.fetch(`${id}.bin`)], { type: "image/webp" })));
        else { const img = new Image(); img.src = `/img/${id}.webp`; await img.decode(); setImage(i, img); }
      } catch { /* keep whatever is showing */ }
    }));
  }
  document.addEventListener("vault:change", (e: Event) => sharpen((e as CustomEvent).detail.unlocked));

  // The canvas spans the full window width; the grid lands over the stage placeholder
  function layout() {
    const w = fx.clientWidth, h = fx.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.position.set(0, 0, small() ? 30 : 34); camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(15)) * camera.position.z, halfW = halfH * camera.aspect;
    const fr = fx.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const cx = ((sr.left + sr.width / 2 - fr.left) / fr.width * 2 - 1) * halfW;
    const cy = (1 - (sr.top + sr.height / 2 - fr.top) / fr.height * 2) * halfH;
    const scale = Math.min(sr.width / fr.width * 2 * halfW / ((W + GAP) * COLS), sr.height / fr.height * 2 * halfH / ((H + GAP) * ROWS)) * 1.02;
    group.scale.setScalar(scale); group.position.set(cx, cy, 0);
    cards.forEach((c, i) => {
      // scatter across the whole hero (on phones, around the card area), with depth; stored in group space
      const y = small() ? (rnd(i + 9) * 2 - 1) * halfH * .3 : (rnd(i + 9) * 2 - 1) * halfH * .95 - cy;
      c.chaos.set(((rnd(i) * 2 - 1) * halfW * 1.05 - cx) / scale, y / scale, ((rnd(i + 3) - .35) * 22) / scale);
      c.holder.visible = !small() || (i % COLS > 0 && i % COLS < COLS - 1);
    });
  }
  addEventListener("resize", layout);

  let mx = 0, my = 0, t0 = 0, visible = true, raf = 0;
  addEventListener("pointermove", e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; }, { passive: true });

  function frame(now: number) {
    const s = (now - t0) / 1000;
    cards.forEach((c, i) => {
      const k = still ? 1 : outQuart(clamp((s - c.start) / FLIGHT));
      const p = c.holder.position.lerpVectors(c.chaos, c.calm, k);
      if (!still) {
        p.x += Math.sin(now / 2400 + i) * .35 * (1 - k);       // slow drift while scattered
        p.y += Math.cos(now / 2100 + i * 1.3) * .3 * (1 - k);
        p.z += Math.sin(now / 3000 + i * .4) * .03 * k;          // the calm grid breathes slightly
      }
      const rk = still ? 1 : inOutSine(clamp((s - c.start) / (FLIGHT * .9)));
      c.holder.rotation.set(c.rot.x * (1 - rk) + (still ? 0 : Math.sin(now / 2600 + i) * .15 * (1 - k)), c.rot.y * (1 - rk), c.rot.z * (1 - rk));
      c.sh.visible = k > .7; c.sh.scale.setScalar(Math.max(.01, (k - .7) / .3));
    });
    group.rotation.y += ((-.3 + (still ? 0 : mx * .1)) - group.rotation.y) * .04;
    group.rotation.x += ((.12 + (still ? 0 : my * .07)) - group.rotation.x) * .04;
    group.rotation.z = -.035;
    renderer.render(scene, camera);
    raf = visible ? requestAnimationFrame(frame) : 0;
  }

  // Pause rendering when the hero is off screen
  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    if (visible && !raf && t0) raf = requestAnimationFrame(frame);
  }).observe(fx);

  const begin = () => {
    if (t0) return;
    layout();
    cards.forEach(c => { c.mat.opacity = 1; });
    t0 = performance.now(); raf = requestAnimationFrame(frame);
    if (vault?.unlocked) sharpen(true);
  };
  Promise.all(loads).then(begin);
  setTimeout(begin, 4000);   // don't wait forever on a slow image
}
