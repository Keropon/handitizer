# handitizer

Turn your hands into live geometry over your webcam. Built with **MediaPipe
HandLandmarker** (hand tracking) and **Three.js** (rendering), composited on a
single WebGL canvas with the camera feed.

**[▶ Live demo](https://keropon.github.io/handitizer/)** · [demo clip (webm)](example.webm)

<video src="https://github.com/Keropon/handitizer/raw/main/example.webm" controls muted width="640"></video>

## How it works

- **Vertices** — every *extended* fingertip becomes a glowing 3D point
  (up to 10 with two hands). A finger counts as "up" when its tip is farther
  from the wrist than the joint below it, so it works in any hand orientation.
- **Polygons** — the points are grouped into polygons (fan-triangulated around
  each group's centroid), with edges drawn as outlines. Grouping is controlled
  from the tweaks panel.
- **Per-polygon shaders** — each polygon is drawn with a different effect,
  cycled across the enabled set: **distortion** (ripple + chromatic
  aberration), **negative** (invert), **sketch** (Sobel edges on paper), and
  **glitch** (block displacement + RGB split + scanlines). All in one combined
  GLSL shader (`js/shaders.js`) selected per polygon via a `uEffect` uniform.
- **Stacked effects** — overlapping polygons *combine* their effects. The scene
  is composited through ping-pong render targets: the mirrored video is drawn
  first, then each polygon samples the composite beneath it, so a negative drawn
  over a distortion shows the negative *of* the distortion.

### Tweaks panel

- **Points / polygon** — cap each polygon at 3, 4, or 5 points.
- **Multiple polygons** — chunk all points into several polygons at once
  (off = a single polygon from the first N points).
- **Cross-hand only** — a polygon must span both hands; the two hands' points
  are interleaved and any single-hand group is dropped (so one hand alone makes
  no polygon).
- **Video on face (audio)** — project a clip you pick (**Clip** file picker)
  onto the polygons, cover-fit to each polygon's bounding box. The clip stays
  local to your browser (an object URL — nothing is uploaded). Its audio volume
  tracks the largest visible polygon's on-screen area (20% floor → 100%) and
  mutes when no polygon is found.
- **Show edges**, **Point size**, **Effect strength**, and per-effect toggles
  (Distortion / Negative / Sketch / Glitch) that set the rotation.
- **Hide UI** button (or the **H** key) hides the panel for a clean capture.

## Run

The app needs `getUserMedia` (camera), which requires an `http(s)` origin
(`localhost` counts). It uses a Vite build so dependencies are bundled,
tree-shaken, and self-hosted (no CDN at runtime).

```sh
npm install
npm run dev      # http://localhost:5173/handitizer/ — click "Enable camera"
```

The first `dev`/`build` runs `scripts/copy-deps.mjs`, which vendors the
MediaPipe WASM runtime out of `node_modules` and downloads the hand model into
`public/` (both git-ignored). For a production bundle:

```sh
npm run build    # outputs dist/
npm run preview  # serve dist/ locally
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes `dist/` to GitHub Pages. The Vite `base` is `/handitizer/` (see
`vite.config.js`); change it if you fork to a different repo name.

## Files

- `index.html` — semantic markup (`<aside>` panel, `<dialog>` gate), CSP, the
  module entry point
- `src/main.js` — camera + HandLandmarker setup, landmark→world mapping, polygon
  grouping, tweaks-panel wiring, hide-UI control, and the ping-pong compositing
  pipeline
- `src/shaders.js` — GLSL for the glowing points and the combined multi-effect
  face shader (incl. the cover-fit video projection)
- `src/styles.css` — all styles (kept external so the CSP needs no
  `'unsafe-inline'`)
- `scripts/copy-deps.mjs` — provisions the self-hosted wasm + model
- `vite.config.js` — build config (`base`, etc.)

## Notes / tuning

- Built against `three@0.184.0` and `@mediapipe/tasks-vision@0.10.35`.
- The video is shown mirrored (selfie view); landmark mapping accounts for this,
  and the face shader samples the already-mirrored composite directly.
- Knobs: most behaviour is in the tweaks panel; in code, the effect maths live
  in `faceFragment` (per-`uEffect` branch), point color in `pointMaterial`,
  finger-up sensitivity in the `1.05` factor in `isFingerUp`, and the audio
  curve in `VOLUME_MIN` / `AREA_FULL` at the top of `src/main.js`.
