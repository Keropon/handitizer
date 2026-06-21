import "./styles.css";
import {
  WebGLRenderer,
  OrthographicCamera,
  Scene,
  WebGLRenderTarget,
  Vector2,
  Vector3,
  Color,
  VideoTexture,
  SRGBColorSpace,
  RepeatWrapping,
  MeshBasicMaterial,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  BufferGeometry,
  BufferAttribute,
  LineLoop,
  LineBasicMaterial,
  Points,
} from "three";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import {
  pointVertex,
  pointFragment,
  faceVertex,
  faceFragment,
} from "./shaders.js";

const FINGERTIPS = [4, 8, 12, 16, 20];
const PIPS = [3, 6, 10, 14, 18];
const WRIST = 0;
const MAX_POINTS = 10;
const MAX_POLYGONS = 4;
const MAX_RING = 6;
const EFFECT_IDS = { distortion: 0, negative: 1, sketch: 2, glitch: 3 };
const EFFECT_ORDER = ["distortion", "negative", "sketch", "glitch"];
const VOLUME_MIN = 0.2;
const AREA_FULL = 0.25;

const WASM_PATH = import.meta.env.BASE_URL + "mediapipe/wasm";
const MODEL_PATH = import.meta.env.BASE_URL + "models/hand_landmarker.task";

const settings = {
  pointsPerPolygon: 5,
  multiple: true,
  crossHandOnly: false,
  showEdges: true,
  video: false,
  pointSize: 26,
  strength: 1.0,
  effects: { distortion: true, negative: true, sketch: true, glitch: true },
};

const canvas = document.getElementById("scene");
const video = document.getElementById("video");
const overlayVideo = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const statusMsg = document.getElementById("status-msg");
const startBtn = document.getElementById("start");
const statHands = document.getElementById("stat-hands");
const statPoints = document.getElementById("stat-points");
const uiToggle = document.getElementById("ui-toggle");

let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
} catch (err) {
  statusMsg.textContent =
    "WebGL is unavailable on this device or browser, so handitizer can't run.";
  startBtn.disabled = true;
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
camera.position.z = 10;

const bgScene = new Scene();
const fxScene = new Scene();
const overlayScene = new Scene();
const quadScene = new Scene();
const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

const rtOpts = { depthBuffer: false, stencilBuffer: false };
let rtA = new WebGLRenderTarget(1, 1, rtOpts);
let rtB = new WebGLRenderTarget(1, 1, rtOpts);

let aspect = 1;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  aspect = w / h;
  camera.left = -aspect;
  camera.right = aspect;
  camera.top = 1;
  camera.bottom = -1;
  camera.updateProjectionMatrix();

  const buf = new Vector2();
  renderer.getDrawingBufferSize(buf);
  rtA.setSize(buf.x, buf.y);
  rtB.setSize(buf.x, buf.y);
  for (const slot of slots) slot.faceMat.uniforms.uResolution.value.copy(buf);
}

let resizePending = false;
window.addEventListener("resize", () => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    resizePending = false;
    resize();
  });
});

let contextLost = false;
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  contextLost = true;
});
canvas.addEventListener("webglcontextrestored", () => {
  contextLost = false;
  resize();
});

const videoTexture = new VideoTexture(video);
videoTexture.colorSpace = SRGBColorSpace;
videoTexture.wrapS = RepeatWrapping;
videoTexture.repeat.x = -1;
videoTexture.offset.x = 1;

const bgMaterial = new MeshBasicMaterial({ map: videoTexture, depthWrite: false });
const bgMesh = new Mesh(new PlaneGeometry(2, 2), bgMaterial);
bgScene.add(bgMesh);

const overlayTexture = new VideoTexture(overlayVideo);
overlayTexture.colorSpace = SRGBColorSpace;

const copyMaterial = new MeshBasicMaterial({ depthTest: false, depthWrite: false });
quadScene.add(new Mesh(new PlaneGeometry(2, 2), copyMaterial));

function blit(srcTexture, dstTarget) {
  copyMaterial.map = srcTexture;
  renderer.setRenderTarget(dstTarget);
  renderer.render(quadScene, quadCam);
}

const slots = [];
for (let i = 0; i < MAX_POLYGONS; i++) {
  const faceGeo = new BufferGeometry();
  faceGeo.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(MAX_RING * 3 * 3), 3)
  );
  const faceMat = new ShaderMaterial({
    vertexShader: faceVertex,
    fragmentShader: faceFragment,
    depthTest: false,
    uniforms: {
      uVideo: { value: null },
      uOverlay: { value: overlayTexture },
      uResolution: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uCenter: { value: new Vector2(0.5, 0.5) },
      uEffect: { value: 0 },
      uVideoMode: { value: 0 },
      uBoundsMin: { value: new Vector2(0, 0) },
      uBoundsMax: { value: new Vector2(1, 1) },
      uOverlayAspect: { value: 1 },
      uStrength: { value: settings.strength },
    },
  });
  const faceMesh = new Mesh(faceGeo, faceMat);
  faceMesh.frustumCulled = false;

  const edgeGeo = new BufferGeometry();
  edgeGeo.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(MAX_RING * 3), 3)
  );
  const edge = new LineLoop(
    edgeGeo,
    new LineBasicMaterial({ color: 0x6fe9ff, transparent: true, opacity: 0.85 })
  );
  edge.frustumCulled = false;
  edge.visible = false;
  overlayScene.add(edge);

  slots.push({ faceMesh, faceMat, faceGeo, edge, edgeGeo, faceActive: false });
}

const pointGeometry = new BufferGeometry();
pointGeometry.setAttribute(
  "position",
  new BufferAttribute(new Float32Array(MAX_POINTS * 3), 3)
);
const pointMaterial = new ShaderMaterial({
  vertexShader: pointVertex,
  fragmentShader: pointFragment,
  transparent: true,
  depthTest: false,
  uniforms: {
    uSize: { value: settings.pointSize },
    uColor: { value: new Color(0x9af2ff) },
  },
});
const points = new Points(pointGeometry, pointMaterial);
points.frustumCulled = false;
overlayScene.add(points);

const _v = new Vector3();
function toWorld(lm, out) {
  out.x = (1 - lm.x - 0.5) * 2 * aspect;
  out.y = (0.5 - lm.y) * 2;
  out.z = -lm.z * 1.5;
  return out;
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isFingerUp(landmarks, tipIdx, pipIdx) {
  const wrist = landmarks[WRIST];
  return dist3(landmarks[tipIdx], wrist) > dist3(landmarks[pipIdx], wrist) * 1.05;
}

const verts = [];

function collectVertices(handsLandmarks) {
  verts.length = 0;
  for (let h = 0; h < handsLandmarks.length; h++) {
    const landmarks = handsLandmarks[h];
    for (let f = 0; f < FINGERTIPS.length; f++) {
      if (isFingerUp(landmarks, FINGERTIPS[f], PIPS[f])) {
        toWorld(landmarks[FINGERTIPS[f]], _v);
        verts.push({ x: _v.x, y: _v.y, z: _v.z, hand: h });
        if (verts.length >= MAX_POINTS) return;
      }
    }
  }
}

function buildPolygons() {
  let ordered;
  if (settings.crossHandOnly) {
    const h0 = verts.filter((v) => v.hand === 0);
    const h1 = verts.filter((v) => v.hand === 1);
    ordered = [];
    const m = Math.max(h0.length, h1.length);
    for (let i = 0; i < m; i++) {
      if (i < h0.length) ordered.push(h0[i]);
      if (i < h1.length) ordered.push(h1[i]);
    }
  } else {
    ordered = verts;
  }

  const P = settings.pointsPerPolygon;
  const groups = [];
  if (!settings.multiple) {
    const g = ordered.slice(0, P);
    if (g.length >= 3) groups.push(g);
  } else {
    for (let i = 0; i < ordered.length; i += P) {
      const g = ordered.slice(i, i + P);
      if (g.length >= 3) groups.push(g);
    }
  }

  const result = settings.crossHandOnly
    ? groups.filter((g) => g.some((v) => v.hand === 0) && g.some((v) => v.hand === 1))
    : groups;
  return result.slice(0, MAX_POLYGONS);
}

function orderRing(list) {
  let cx = 0, cy = 0, cz = 0;
  for (const v of list) { cx += v.x; cy += v.y; cz += v.z; }
  const n = list.length;
  cx /= n; cy /= n; cz /= n;
  const ring = list.slice().sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  return { ring, center: { x: cx, y: cy, z: cz } };
}

function enabledEffects() {
  return EFFECT_ORDER.filter((name) => settings.effects[name]).map((name) => EFFECT_IDS[name]);
}

function updatePoints() {
  const pos = pointGeometry.attributes.position;
  for (let i = 0; i < verts.length; i++) pos.setXYZ(i, verts[i].x, verts[i].y, verts[i].z);
  pos.needsUpdate = true;
  pointGeometry.setDrawRange(0, verts.length);
}

function fillFace(slot, ring, center) {
  const pos = slot.faceGeo.attributes.position;
  const n = ring.length;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    pos.setXYZ(t++, center.x, center.y, center.z);
    pos.setXYZ(t++, a.x, a.y, a.z);
    pos.setXYZ(t++, b.x, b.y, b.z);
  }
  pos.needsUpdate = true;
  slot.faceGeo.setDrawRange(0, t);
  slot.faceMat.uniforms.uCenter.value.set(
    0.5 + center.x / (2 * aspect),
    0.5 + center.y / 2
  );
}

function fillEdge(slot, ring) {
  const pos = slot.edgeGeo.attributes.position;
  for (let i = 0; i < ring.length; i++) pos.setXYZ(i, ring[i].x, ring[i].y, ring[i].z);
  pos.needsUpdate = true;
  slot.edgeGeo.setDrawRange(0, ring.length);
}

function screenU(v) { return 0.5 + v.x / (2 * aspect); }
function screenV(v) { return 0.5 + v.y / 2; }

function fillVideoBounds(slot, ring) {
  let minx = 1, miny = 1, maxx = 0, maxy = 0;
  for (const v of ring) {
    const ux = screenU(v), uy = screenV(v);
    if (ux < minx) minx = ux; if (ux > maxx) maxx = ux;
    if (uy < miny) miny = uy; if (uy > maxy) maxy = uy;
  }
  slot.faceMat.uniforms.uBoundsMin.value.set(minx, miny);
  slot.faceMat.uniforms.uBoundsMax.value.set(maxx, maxy);
  if (overlayVideo.videoWidth) {
    slot.faceMat.uniforms.uOverlayAspect.value =
      overlayVideo.videoWidth / overlayVideo.videoHeight;
  }
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += screenU(p) * screenV(q) - screenU(q) * screenV(p);
  }
  return Math.abs(a) / 2;
}

function updateAudio(maxArea, anyVideoFace) {
  if (!settings.video) return;
  overlayVideo.volume = anyVideoFace
    ? VOLUME_MIN + (1 - VOLUME_MIN) * Math.min(maxArea / AREA_FULL, 1)
    : 0;
}

function updateBackgroundCover() {
  if (!video.videoWidth) return;
  const videoAspect = video.videoWidth / video.videoHeight;
  let sx, sy;
  if (videoAspect > aspect) { sy = 1; sx = videoAspect / aspect; }
  else { sx = 1; sy = aspect / videoAspect; }
  bgMesh.scale.set(aspect * sx, sy, 1);
}

let handLandmarker = null;
let lastVideoTime = -1;

async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

let startTime = performance.now();

function updateGeometry(hands) {
  collectVertices(hands);
  updatePoints();

  const groups = buildPolygons();
  const fx = enabledEffects();
  let maxArea = 0;
  let anyVideoFace = false;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const g = groups[i];
    if (g) {
      const { ring, center } = orderRing(g);
      slot.edge.visible = settings.showEdges;
      if (settings.showEdges) fillEdge(slot, ring);
      if (settings.video && overlayVideo.dataset.objurl) {
        fillFace(slot, ring, center);
        fillVideoBounds(slot, ring);
        slot.faceMat.uniforms.uVideoMode.value = 1;
        slot.faceActive = true;
        anyVideoFace = true;
        const area = ringArea(ring);
        if (area > maxArea) maxArea = area;
      } else if (fx.length > 0) {
        fillFace(slot, ring, center);
        slot.faceMat.uniforms.uVideoMode.value = 0;
        slot.faceMat.uniforms.uEffect.value = fx[i % fx.length];
        slot.faceActive = true;
      } else {
        slot.faceActive = false;
      }
    } else {
      slot.edge.visible = false;
      slot.faceActive = false;
    }
  }

  updateAudio(maxArea, anyVideoFace);
  statHands.textContent = hands.length;
  statPoints.textContent = verts.length;
}

function frame() {
  requestAnimationFrame(frame);
  if (contextLost) return;
  const time = (performance.now() - startTime) / 1000;
  updateBackgroundCover();

  if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    updateGeometry(result.landmarks || []);
  }

  for (const slot of slots) {
    if (!slot.faceActive) continue;
    slot.faceMat.uniforms.uTime.value = time;
    slot.faceMat.uniforms.uStrength.value = settings.strength;
  }

  render();
}

function render() {
  renderer.setRenderTarget(rtA);
  renderer.render(bgScene, camera);
  let read = rtA, write = rtB;

  for (const slot of slots) {
    if (!slot.faceActive) continue;
    blit(read.texture, write);
    slot.faceMat.uniforms.uVideo.value = read.texture;
    fxScene.add(slot.faceMesh);
    renderer.autoClear = false;
    renderer.setRenderTarget(write);
    renderer.render(fxScene, camera);
    renderer.autoClear = true;
    fxScene.remove(slot.faceMesh);
    const tmp = read; read = write; write = tmp;
  }

  blit(read.texture, null);

  renderer.autoClear = false;
  renderer.setRenderTarget(null);
  renderer.render(overlayScene, camera);
  renderer.autoClear = true;
}

function setUIHidden(hidden) {
  document.body.classList.toggle("ui-hidden", hidden);
  uiToggle.setAttribute("aria-pressed", String(hidden));
  uiToggle.textContent = hidden ? "Show UI" : "Hide UI";
}
uiToggle.addEventListener("click", () =>
  setUIHidden(!document.body.classList.contains("ui-hidden"))
);
window.addEventListener("keydown", (e) => {
  if (e.key !== "h" && e.key !== "H") return;
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  setUIHidden(!document.body.classList.contains("ui-hidden"));
});

function wirePanel() {
  const $ = (id) => document.getElementById(id);
  const panel = $("panel");
  const head = $("panel-head");
  $("panel-body").addEventListener("submit", (e) => e.preventDefault());
  head.addEventListener("click", () => {
    const collapsed = panel.toggleAttribute("data-collapsed");
    head.setAttribute("aria-expanded", String(!collapsed));
  });
  $("pp").addEventListener("change", (e) => (settings.pointsPerPolygon = +e.target.value));
  $("multi").addEventListener("change", (e) => (settings.multiple = e.target.checked));
  $("cross").addEventListener("change", (e) => (settings.crossHandOnly = e.target.checked));
  $("edges").addEventListener("change", (e) => (settings.showEdges = e.target.checked));
  $("vid").addEventListener("change", (e) => {
    settings.video = e.target.checked;
    if (settings.video) {
      overlayVideo.muted = false;
      overlayVideo.volume = 0;
      overlayVideo.play().catch(() => {});
    } else {
      overlayVideo.pause();
    }
  });
  $("vidfile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (overlayVideo.dataset.objurl) URL.revokeObjectURL(overlayVideo.dataset.objurl);
    const url = URL.createObjectURL(file);
    overlayVideo.dataset.objurl = url;
    overlayVideo.src = url;
    overlayVideo.load();
    $("vidname").textContent = file.name;
    if (settings.video) {
      overlayVideo.muted = false;
      overlayVideo.play().catch(() => {});
    }
  });
  $("psize").addEventListener("input", (e) => {
    settings.pointSize = +e.target.value;
    pointMaterial.uniforms.uSize.value = settings.pointSize;
  });
  $("strength").addEventListener("input", (e) => (settings.strength = +e.target.value));
  for (const name of EFFECT_ORDER) {
    $("fx-" + name).addEventListener("change", (e) => (settings.effects[name] = e.target.checked));
  }
}

window.addEventListener("pagehide", () => {
  if (overlayVideo.dataset.objurl) URL.revokeObjectURL(overlayVideo.dataset.objurl);
});

async function start() {
  startBtn.disabled = true;
  statusMsg.textContent = "loading hand model…";
  try {
    await initHandLandmarker();
    statusMsg.textContent = "starting camera…";
    await initCamera();
    resize();
    statusEl.close();
    startTime = performance.now();
    frame();
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    statusMsg.textContent = "";
    const span = document.createElement("span");
    span.className = "err";
    span.textContent = err && err.message ? err.message : String(err);
    statusMsg.append(
      span,
      document.createElement("br"),
      document.createTextNode(
        "Grant camera access and try again. Must be served over http(s)."
      )
    );
  }
}

wirePanel();
startBtn.addEventListener("click", start);
resize();
