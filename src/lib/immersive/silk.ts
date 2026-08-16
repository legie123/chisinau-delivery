import * as THREE from "three";
import { SECTOR_LOOKS, type SectorKey, type SectorLook } from "./sectors";

// „Mătasea de Dragon" — o singură pânză mare, deformată în vertex shader, cu
// lumină aurie pe creste și un puls care trece pe dedesubt ca o venă. Peste ea,
// un câmp rar de scântei de jar. three.js pur: fără R3F, fără drei, fără
// postprocessing multi-pass (bloom-ul e cel mai scump efect pe mobil, iar
// strălucirea se simulează mai ieftin din shader).
//
// Un singur canvas trăiește în layout și își schimbă culorile la navigare, ca
// trecerea dintre sectoare să fie o transformare, nu o reîncărcare.

export type Tier = "full" | "reduced";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uTurbulence;
uniform vec2 uPointer;
varying vec2 vUv;
varying float vCrest;
varying vec3 vPos;

// zgomot ieftin, suficient pentru textil
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

void main(){
  vUv = uv;
  vec3 p = position;

  // Două valuri lungi încrucișate + un strat de zgomot = falduri de material,
  // nu ondulație de apă.
  float t = uTime * 0.22;
  float wave = sin(p.x * 0.75 + t) * 0.62
             + sin(p.y * 0.55 - t * 0.85) * 0.5
             + (noise(p.xy * 0.42 + t * 0.35) - 0.5) * 1.15;

  // Degetul/mouse-ul apasă în pânză: o adâncitură moale care se stinge cu
  // distanța (decizia „reacție fină la deget și scroll").
  float d = distance(p.xy, uPointer * vec2(3.2, 2.2));
  float touch = exp(-d * d * 0.55) * 0.55;

  p.z += (wave * uTurbulence) - touch;

  // Cât de „sus" e faldul — folosit în fragment ca lumină de creastă.
  vCrest = smoothstep(-0.55, 0.95, p.z);
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uDeep;
uniform vec3 uRim;
uniform vec3 uPulse;
uniform float uTime;
uniform float uEnergy;
varying vec2 vUv;
varying float vCrest;
varying vec3 vPos;

void main(){
  // Baza: navy adânc, mai închis spre margini (vignetă din UV, gratis).
  vec2 c = vUv - 0.5;
  float vig = 1.0 - dot(c, c) * 0.85;

  // Lumina de pe creste — aurul care „prinde" faldul.
  float rim = pow(vCrest, 1.7) * (0.75 + 0.45 * uEnergy);

  // Vena: un puls care traversează pânza pe diagonală, lent. Ăsta e
  // „dragonul respiră" — se vede doar în adânciturile dintre falduri.
  float vein = sin((vPos.x * 0.55 + vPos.y * 0.35) - uTime * 0.5);
  vein = pow(max(vein, 0.0), 6.0) * (1.0 - vCrest) * uEnergy;

  vec3 col = uDeep;
  col += uRim * rim * 1.15;
  col += uPulse * vein * 0.75;

  // Strălucire simulată: miezul crestei devine aproape alb-auriu, fără bloom.
  col += uRim * pow(rim, 3.0) * 0.35;

  gl_FragColor = vec4(col * vig, 1.0);
}
`;

const EMBER_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uRise;
uniform float uSize;
varying float vAlpha;
void main(){
  vec3 p = position;
  // Urcă lent și se leagănă; când iese sus, reintră jos (buclă fără cusătură).
  float life = fract(aSeed + uTime * uRise);
  p.y = mix(-3.2, 3.4, life);
  p.x += sin((life + aSeed) * 6.28318) * 0.45;
  p.z += cos((life + aSeed) * 4.1) * 0.25;
  // Se aprinde la plecare, se stinge la capăt.
  vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.55, 1.0, life));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (1.0 + aSeed * 1.6) * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const EMBER_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uWarmth;
varying float vAlpha;
void main(){
  // Punct rotund cu margine moale, fără textură încărcată.
  vec2 d = gl_PointCoord - 0.5;
  float m = 1.0 - smoothstep(0.14, 0.5, length(d));
  if (m <= 0.01) discard;
  gl_FragColor = vec4(uColor * uWarmth, m * vAlpha);
}
`;

export type SilkHandle = {
  setSector: (key: SectorKey) => void;
  setScroll: (v: number) => void;
  dispose: () => void;
};

export function createSilk(canvas: HTMLCanvasElement, initial: SectorKey, tier: Tier): SilkHandle {
  const look = SECTOR_LOOKS[initial];

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "low-power",
  });
  // Pixel ratio plafonat: pe telefoanele noi devicePixelRatio e 3, iar costul
  // crește pătratic cu el. Tier-ul redus coboară și mai jos.
  const maxDpr = tier === "full" ? 2 : 1.25;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 40);
  camera.position.set(0, 0, look.intro.distance);

  const uniforms = {
    uTime: { value: 0 },
    uTurbulence: { value: look.intro.turbulence },
    uEnergy: { value: look.restEnergy },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uDeep: { value: new THREE.Color(...look.deep) },
    uRim: { value: new THREE.Color(...look.rim) },
    uPulse: { value: new THREE.Color(...look.pulse) },
  };

  // Segmentarea e cheltuiala principală a pânzei: pe tier redus tăiem la
  // jumătate, iar faldurile rămân credibile fiindcă deformarea e lină.
  const seg = tier === "full" ? 96 : 48;
  const silk = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 9, seg, seg),
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms }),
  );
  silk.rotation.x = -0.32;
  scene.add(silk);

  // ---- scântei de jar ----
  const emberCount = Math.round(look.embers.count * (tier === "full" ? 1 : 0.45));
  const positions = new Float32Array(emberCount * 3);
  const seeds = new Float32Array(emberCount);
  for (let i = 0; i < emberCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 8.5;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2.5 + 0.6;
    seeds[i] = Math.random();
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  emberGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

  const emberUniforms = {
    uTime: { value: 0 },
    uRise: { value: look.embers.rise },
    uWarmth: { value: look.embers.warmth },
    uSize: { value: tier === "full" ? 4.2 : 3.2 },
    uColor: { value: new THREE.Color(...look.rim) },
  };
  const embers = new THREE.Points(
    emberGeo,
    new THREE.ShaderMaterial({
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      uniforms: emberUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(embers);

  // ---- stare de regie și tranziție ----
  let current = look;
  let target = look;
  let blend = 1; // 1 = ajuns complet în lumea curentă
  let introStart = performance.now();
  let pointerX = 0;
  let pointerY = 0;
  let scroll = 0;
  let running = true;
  let raf = 0;

  const tmpDeep = new THREE.Color();
  const tmpRim = new THREE.Color();
  const tmpPulse = new THREE.Color();

  function onPointer(e: PointerEvent) {
    pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerY = -((e.clientY / window.innerHeight) * 2 - 1);
  }
  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  function onVisibility() {
    // Tab în fundal: oprim complet bucla — nu ardem baterie pe ce nu se vede.
    if (document.hidden) stop();
    else start();
  }
  // Bugul iOS: Safari pierde contextul WebGL la backgrounding. Nu se poate
  // preveni, doar reluat — altfel rămâne un dreptunghi negru.
  function onLost(e: Event) {
    e.preventDefault();
    stop();
  }
  function onRestored() {
    introStart = performance.now();
    start();
  }

  function frame() {
    if (!running) return;
    const now = performance.now();
    const t = now / 1000;

    // Regia de deschidere: turbulența și distanța camerei se sting spre repaus.
    const elapsed = (now - introStart) / 1000;
    const k = Math.min(elapsed / current.intro.seconds, 1);
    const eased = 1 - Math.pow(1 - k, 3);

    // Tranziția între sectoare: aceeași pânză, alte culori (≈1s).
    if (blend < 1) {
      blend = Math.min(blend + 1 / 60 / 1.0, 1);
      tmpDeep.setRGB(...current.deep).lerp(new THREE.Color(...target.deep), blend);
      tmpRim.setRGB(...current.rim).lerp(new THREE.Color(...target.rim), blend);
      tmpPulse.setRGB(...current.pulse).lerp(new THREE.Color(...target.pulse), blend);
      uniforms.uDeep.value.copy(tmpDeep);
      uniforms.uRim.value.copy(tmpRim);
      uniforms.uPulse.value.copy(tmpPulse);
      emberUniforms.uColor.value.copy(tmpRim);
      if (blend >= 1) current = target;
    }

    uniforms.uTime.value = t;
    emberUniforms.uTime.value = t;
    uniforms.uTurbulence.value =
      current.intro.turbulence * (1 - eased) + 1.0 * eased;
    uniforms.uEnergy.value = current.restEnergy * (0.55 + 0.45 * eased);

    // Degetul mișcă materialul; scroll-ul îl împinge lin în adâncime.
    uniforms.uPointer.value.set(pointerX * 0.9, pointerY * 0.9 - scroll * 0.4);
    camera.position.z =
      current.intro.distance * (1 - eased) + (current.intro.distance - 0.55) * eased + scroll * 0.35;
    silk.rotation.z = Math.sin(t * 0.08) * 0.03;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onLost as EventListener);
  canvas.addEventListener("webglcontextrestored", onRestored);
  raf = requestAnimationFrame(frame);

  return {
    setSector(key: SectorKey) {
      const next = SECTOR_LOOKS[key];
      if (next === target) return;
      current = target;
      target = next;
      blend = 0;
      introStart = performance.now(); // fiecare sector își joacă regia lui
    },
    setScroll(v: number) {
      scroll = v;
    },
    dispose() {
      stop();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost as EventListener);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      silk.geometry.dispose();
      (silk.material as THREE.Material).dispose();
      emberGeo.dispose();
      (embers.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

/**
 * Decide ce poate duce telefonul ÎNAINTE de a monta scena grea: randează un
 * cadru ieftin ~600ms și măsoară cadrele reale. E singurul semnal universal —
 * nivelul bateriei nu se poate citi în niciun browser major, iar
 * `hardwareConcurrency` lipsește din Safari, adică din 42% din piața locală.
 */
export function probeTier(): Promise<Tier | "off"> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve("off");
    const test = document.createElement("canvas");
    const gl = test.getContext("webgl2") ?? test.getContext("webgl");
    if (!gl) return resolve("off");

    // Capcană plătită la prima probă pe telefon emulat: măsurată IMEDIAT după
    // montare, sonda prinde procesorul ocupat cu hidratarea React și raportează
    // sub prag — un telefon perfect capabil era clasat „off" pe toată sesiunea.
    // Așteptăm liniștea, apoi măsurăm mai lung.
    let retried = false;
    const measure = () => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        const dt = performance.now() - t0;
        if (dt < 900) return requestAnimationFrame(tick);
        const fps = (frames * 1000) / dt;
        // Praguri: peste 45 = pânza completă; 20-45 = versiunea ușoară (jumătate
        // din segmente, mai puține scântei, pixel ratio mai mic); sub 20 =
        // animația ar fi sacadată, deci rămâne gradientul static.
        const verdict: Tier | "off" = fps >= 45 ? "full" : fps >= 20 ? "reduced" : "off";
        // O singură a doua șansă: prima măsurătoare poate cădea pe un vârf de
        // lucru (imagini care se decodează, fonturi). Dacă a ieșit „off", mai
        // încercăm o dată după ce se liniștește, ca să nu condamnăm un telefon
        // bun pe baza unei secunde proaste.
        if (verdict === "off" && !retried) {
          retried = true;
          setTimeout(measure, 2000);
          return;
        }
        resolve(verdict);
      };
      requestAnimationFrame(tick);
    };

    // Deliberat setTimeout, nu requestIdleCallback: sub încetinire de procesor
    // pagina nu ajunge niciodată „idle", iar `timeout`-ul nu a fost respectat în
    // testele pe mobil emulat — proba nu se declanșa deloc și fundalul rămânea
    // veșnic nedecis. Un timp fix e mai puțin elegant și mult mai sigur.
    setTimeout(measure, 1200);
  });
}
