export const pointVertex = `
  uniform float uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize;
  }
`;

export const pointFragment = `
  uniform vec3 uColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float glow = pow(core, 2.5);
    gl_FragColor = vec4(uColor * (0.4 + glow), glow);
  }
`;

export const faceVertex = `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const faceFragment = `
  precision highp float;
  uniform sampler2D uVideo;
  uniform sampler2D uOverlay;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec2  uCenter;
  uniform int   uEffect;
  uniform int   uVideoMode;
  uniform vec2  uBoundsMin;
  uniform vec2  uBoundsMax;
  uniform float uOverlayAspect;
  uniform float uStrength;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  vec3 src(vec2 uv) { return texture2D(uVideo, uv).rgb; }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec2 texel = 1.0 / uResolution;
    vec3 col;

    if (uVideoMode == 1) {
      vec2 vuv = (uv - uBoundsMin) / max(uBoundsMax - uBoundsMin, vec2(1e-4));
      float boxAspect = ((uBoundsMax.x - uBoundsMin.x) * uResolution.x)
                      / max((uBoundsMax.y - uBoundsMin.y) * uResolution.y, 1e-4);
      float ratio = uOverlayAspect / boxAspect;
      if (ratio > 1.0) vuv.x = (vuv.x - 0.5) / ratio + 0.5;
      else             vuv.y = (vuv.y - 0.5) * ratio + 0.5;
      gl_FragColor = vec4(texture2D(uOverlay, clamp(vuv, 0.0, 1.0)).rgb, 1.0);
      return;
    }

    if (uEffect == 0) {
      vec2 rel = uv - uCenter;
      float r = length(rel);
      vec2 dir = rel / (r + 1e-4);
      float ripple = sin(r * 38.0 - uTime * 4.0) * 0.018 * uStrength;
      vec2 swirl = 0.012 * uStrength * vec2(
        sin(uTime * 1.3 + uv.y * 26.0),
        cos(uTime * 1.1 + uv.x * 26.0)
      );
      vec2 duv = uv + dir * ripple + swirl;
      float ca = 0.01 * uStrength;
      col.r = src(duv + dir * ca).r;
      col.g = src(duv).g;
      col.b = src(duv - dir * ca).b;
    } else if (uEffect == 1) {
      col = 1.0 - src(uv);
    } else if (uEffect == 2) {
      float tl = luma(src(uv + texel * vec2(-1.0,  1.0)));
      float  l = luma(src(uv + texel * vec2(-1.0,  0.0)));
      float bl = luma(src(uv + texel * vec2(-1.0, -1.0)));
      float  t = luma(src(uv + texel * vec2( 0.0,  1.0)));
      float  b = luma(src(uv + texel * vec2( 0.0, -1.0)));
      float tr = luma(src(uv + texel * vec2( 1.0,  1.0)));
      float  r = luma(src(uv + texel * vec2( 1.0,  0.0)));
      float br = luma(src(uv + texel * vec2( 1.0, -1.0)));
      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
      float gy =  tl + 2.0 * t + tr - bl - 2.0 * b - br;
      float edge = clamp(length(vec2(gx, gy)) * (1.0 + uStrength), 0.0, 1.0);
      col = vec3(1.0 - edge);
    } else {
      float blocks = 24.0;
      float row = floor(uv.y * blocks);
      float n = hash(row + floor(uTime * 12.0));
      float shift = (n - 0.5) * 0.1 * step(0.7, n) * (0.5 + uStrength);
      vec2 g = uv + vec2(shift, 0.0);
      float split = 0.02 * (0.5 + uStrength) * step(0.6, hash(row * 1.7 + floor(uTime * 8.0)));
      col.r = src(g + vec2(split, 0.0)).r;
      col.g = src(g).g;
      col.b = src(g - vec2(split, 0.0)).b;
      col *= 0.85 + 0.15 * sin(uv.y * uResolution.y * 1.2);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;
