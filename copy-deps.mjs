import { cp, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";

const root = dirname(fileURLToPath(import.meta.url));

const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDest = join(root, "public", "mediapipe", "wasm");
await mkdir(wasmDest, { recursive: true });
await cp(wasmSrc, wasmDest, { recursive: true });
console.log(`copied MediaPipe wasm -> ${wasmDest}`);

const modelDir = join(root, "public", "models");
const modelPath = join(modelDir, "hand_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

try {
  await access(modelPath);
  console.log("hand model already present, skipping download");
} catch {
  console.log("downloading hand model…");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  await mkdir(modelDir, { recursive: true });
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded hand model -> ${modelPath}`);
}
