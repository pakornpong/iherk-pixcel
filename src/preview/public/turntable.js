// Real-time 60 FPS WebGL2 Orthographic 360° Pixel-Art Turntable Renderer (zero dependencies)

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function computeCameraBasis(yawDeg, pitchDeg) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  return {
    forward: [sy * cp, cy * cp, sp],
    right: [-cy, sy, 0],
    up: [-sy * sp, -cy * sp, cp],
  };
}

export const DEFAULT_SNAP_STEP_DEG = 5;

export function snapAngle(deg, stepDeg) {
  if (!Number.isFinite(deg) || !Number.isFinite(stepDeg) || stepDeg <= 0) return deg;
  return Math.round(deg / stepDeg) * stepDeg;
}

export function snapViewScale(halfH, fboH) {
  const usable = (v) => Number.isFinite(v) && v > 0;
  const h = usable(halfH) ? halfH : 1;
  const f = usable(fboH) ? fboH : 1;
  let ppv = f / (2 * h);
  if (!usable(ppv)) ppv = f / 2;
  let snapped;
  if (ppv >= 1) {
    snapped = Math.round(ppv);
  } else {
    const n = Math.min(1e9, Math.max(1, Math.round(1 / ppv)));
    snapped = 1 / n;
  }
  return { halfH: f / (2 * snapped), worldPerPixel: 1 / snapped, pixelsPerVoxel: snapped };
}

export function snapPan(pan, worldPerPixel) {
  if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return pan;
  return Math.round(pan / worldPerPixel) * worldPerPixel;
}

export function computeRenderCamera(state) {
  const { zoom, radius, fboW, fboH, pixelMode } = state;
  const snapping = state.pixelSnap && pixelMode === "pixelart";
  let yawDeg = state.yawDeg;
  let pitchDeg = state.pitchDeg;
  let halfH = (radius * 1.32) / zoom;
  let panX = state.panX;
  let panY = state.panY;
  let pixelsPerVoxel = fboH / (2 * halfH);
  if (snapping) {
    yawDeg = snapAngle(yawDeg, state.snapStepDeg);
    pitchDeg = Math.max(-89, Math.min(89, snapAngle(pitchDeg, state.snapStepDeg)));
    const scale = snapViewScale(halfH, fboH);
    halfH = scale.halfH;
    pixelsPerVoxel = scale.pixelsPerVoxel;
    panX = snapPan(panX, scale.worldPerPixel);
    panY = snapPan(panY, scale.worldPerPixel);
  }
  return { yawDeg, pitchDeg, halfW: halfH * (fboW / fboH), halfH, panX, panY, pixelsPerVoxel };
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const GEOM_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec3 aBaseCol;
layout(location = 3) in vec3 aHiCol;
layout(location = 4) in vec3 aShCol;
layout(location = 5) in float aAO;
layout(location = 6) in float aFlag;

uniform vec3 uCenter;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform vec2 uHalfView;
uniform vec2 uPan;
uniform float uDepthScale;

out vec3 vNorm;
out vec3 vBaseCol;
out vec3 vHiCol;
out vec3 vShCol;
out float vAO;
out float vFlag;

void main() {
  vec3 p = aPos - uCenter;
  float sx = (dot(p, uCamRight) + uPan.x) / uHalfView.x;
  float sy = (dot(p, uCamUp) + uPan.y) / uHalfView.y;
  float sz = -dot(p, uCamForward) * uDepthScale;
  gl_Position = vec4(sx, sy, sz, 1.0);
  vNorm = aNorm;
  vBaseCol = aBaseCol;
  vHiCol = aHiCol;
  vShCol = aShCol;
  vAO = aAO;
  vFlag = aFlag;
}
`;

const GEOM_FRAG = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec3 vBaseCol;
in vec3 vHiCol;
in vec3 vShCol;
in float vAO;
in float vFlag;

uniform vec3 uLightDir;
uniform float uShading;

out vec4 fragColor;

void main() {
  bool isEmissive = (vFlag > 0.5 && vFlag < 1.5);
  bool isGlass = (vFlag > 1.5 && vFlag < 2.5);

  vec3 col = vBaseCol;
  if (!isEmissive && uShading > 0.5) {
    float ndotl = dot(normalize(vNorm), uLightDir);
    float lit = (ndotl * 0.5 + 0.5) * (0.45 + 0.55 * vAO);
    if (lit >= 0.72 || (isGlass && lit >= 0.62)) {
      float k = clamp((lit - 0.68) / 0.28, 0.0, 1.0);
      col = mix(vBaseCol, vHiCol, k);
    } else if (lit < 0.46) {
      float k = clamp((0.46 - lit) / 0.34, 0.0, 1.0);
      col = mix(vBaseCol, vShCol, k);
    } else if (vAO < 0.92) {
      float k = (1.0 - vAO) * 0.7;
      col = mix(vBaseCol, vShCol, k);
    }
  }
  // Encode emissive flag cleanly in alpha (250/255 vs 255/255) for 1-pass glow
  float outA = isEmissive ? (250.0 / 255.0) : 1.0;
  fragColor = vec4(col, outA);
}
`;

const POST_VERT = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUV;
void main() {
  vec2 p = POS[gl_VertexID];
  gl_Position = vec4(p, 0.0, 1.0);
  vUV = p * 0.5 + 0.5;
}
`;

const POST_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;

uniform sampler2D uTex;
uniform ivec2 uFboSize;
uniform vec3 uBgColor;
uniform vec3 uBgEdgeColor;
uniform float uOutline;
uniform float uShowGlow;

out vec4 fragColor;

bool isEmissivePixel(vec4 s) {
  return s.a > 0.95 && s.a < 0.992;
}

void main() {
  ivec2 tc = clamp(ivec2(floor(vUV * vec2(uFboSize))), ivec2(0), uFboSize - ivec2(1));
  vec4 center = texelFetch(uTex, tc, 0);

  // Subtle studio radial gradient background
  vec2 d = vUV - vec2(0.5);
  float vig = clamp(dot(d, d) * 1.9, 0.0, 1.0);
  vec3 bg = mix(uBgColor, uBgEdgeColor, vig);

  if (center.a > 0.5) {
    vec3 col = center.rgb;
    if (uShowGlow > 0.5 && !isEmissivePixel(center)) {
      vec3 glowAdd = vec3(0.0);
      for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
          if (dx == 0 && dy == 0) continue;
          ivec2 nc = tc + ivec2(dx, dy);
          if (nc.x < 0 || nc.y < 0 || nc.x >= uFboSize.x || nc.y >= uFboSize.y) continue;
          vec4 ns = texelFetch(uTex, nc, 0);
          if (isEmissivePixel(ns)) {
            float dist = length(vec2(float(dx), float(dy)));
            glowAdd += ns.rgb * max(0.0, (1.0 - dist / 2.6)) * 0.16;
          }
        }
      }
      col = min(vec3(1.0), col + glowAdd);
    }
    fragColor = vec4(col, 1.0);
    return;
  }

  // 1px dark-tinted silhouette outline on 4-connected exterior neighbors
  if (uOutline > 0.5) {
    ivec2 offs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
    bool touches = false;
    float minLum = 999.0;
    vec3 darkCol = vec3(0.06, 0.08, 0.14);
    for (int i = 0; i < 4; i++) {
      ivec2 nc = tc + offs[i];
      if (nc.x < 0 || nc.y < 0 || nc.x >= uFboSize.x || nc.y >= uFboSize.y) continue;
      vec4 ns = texelFetch(uTex, nc, 0);
      if (ns.a > 0.5) {
        touches = true;
        float lum = dot(ns.rgb, vec3(0.299, 0.587, 0.114));
        if (lum < minLum) {
          minLum = lum;
          darkCol = ns.rgb * vec3(0.28, 0.28, 0.34);
        }
      }
    }
    if (touches) {
      fragColor = vec4(darkCol, 1.0);
      return;
    }
  }

  // Subtle radial glow halo into background around emissive voxels
  if (uShowGlow > 0.5) {
    vec3 glowAcc = vec3(0.0);
    float glowWeight = 0.0;
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        ivec2 nc = tc + ivec2(dx, dy);
        if (nc.x < 0 || nc.y < 0 || nc.x >= uFboSize.x || nc.y >= uFboSize.y) continue;
        vec4 ns = texelFetch(uTex, nc, 0);
        if (isEmissivePixel(ns)) {
          float dist = length(vec2(float(dx), float(dy)));
          float w = max(0.0, (1.0 - dist / 2.6)) * 0.28;
          glowAcc += ns.rgb * w;
          glowWeight += w;
        }
      }
    }
    if (glowWeight > 0.001) {
      bg = min(vec3(1.0), bg + glowAcc);
    }
  }

  fragColor = vec4(bg, 1.0);
}
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`WebGL shader error: ${log}`);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  const prog = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`WebGL link error: ${log}`);
  }
  return prog;
}

const BG_THEMES = {
  night: { center: [0.07, 0.10, 0.18], edge: [0.035, 0.05, 0.10] },
  slate: { center: [0.14, 0.17, 0.23], edge: [0.08, 0.10, 0.14] },
  light: { center: [0.93, 0.94, 0.96], edge: [0.84, 0.87, 0.91] },
};

export class VoxelTurntableViewport {
  constructor(canvas, onHudUpdate) {
    this.canvas = canvas;
    this.onHudUpdate = onHudUpdate;
    this.gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    this.supported = Boolean(this.gl);

    // Camera & rendering state
    this.yawDeg = 315; // Classic front-left SE 3/4 view
    this.pitchDeg = 30; // Exact 2:1 isometric pitch
    this.targetYaw = null;
    this.targetPitch = null;
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.pixelMode = "pixelart"; // "pixelart" | "3d"
    this.pixelSize = 4; // Display pixels per logical pixel-art pixel
    this.pixelSnap = true; // Snap the rendered camera to the pixel grid (pixelart mode only)
    this.snapStepDeg = DEFAULT_SNAP_STEP_DEG;
    this.outline = true;
    this.shading = true;
    this.lightLock = "camera"; // "camera" | "world"
    this.bgTheme = "night";
    this.autoSpin = false;
    this.spinSpeed = 48; // deg/sec

    // Mesh state
    this.bounds = { centerX: 16, centerY: 16, centerZ: 14, radius: 22 };
    this.vertexCount = 0;
    this.faceCount = 0;
    this.meshCache = new Map();

    // Pointer interaction
    this.dragging = false;
    this.panning = false;
    this.lastX = 0;
    this.lastY = 0;
    this.velYaw = 0;
    this.velPitch = 0;

    this.running = false;
    this.lastTime = 0;
    this.fboW = 0;
    this.fboH = 0;

    if (this.supported) {
      this._initGL();
      this._bindEvents();
    }
  }

  _initGL() {
    const gl = this.gl;
    this.geomProg = createProgram(gl, GEOM_VERT, GEOM_FRAG);
    this.postProg = createProgram(gl, POST_VERT, POST_FRAG);

    this.uGeom = {
      uCenter: gl.getUniformLocation(this.geomProg, "uCenter"),
      uCamRight: gl.getUniformLocation(this.geomProg, "uCamRight"),
      uCamUp: gl.getUniformLocation(this.geomProg, "uCamUp"),
      uCamForward: gl.getUniformLocation(this.geomProg, "uCamForward"),
      uHalfView: gl.getUniformLocation(this.geomProg, "uHalfView"),
      uPan: gl.getUniformLocation(this.geomProg, "uPan"),
      uDepthScale: gl.getUniformLocation(this.geomProg, "uDepthScale"),
      uLightDir: gl.getUniformLocation(this.geomProg, "uLightDir"),
      uShading: gl.getUniformLocation(this.geomProg, "uShading"),
    };

    this.uPost = {
      uTex: gl.getUniformLocation(this.postProg, "uTex"),
      uFboSize: gl.getUniformLocation(this.postProg, "uFboSize"),
      uBgColor: gl.getUniformLocation(this.postProg, "uBgColor"),
      uBgEdgeColor: gl.getUniformLocation(this.postProg, "uBgEdgeColor"),
      uOutline: gl.getUniformLocation(this.postProg, "uOutline"),
      uShowGlow: gl.getUniformLocation(this.postProg, "uShowGlow"),
    };

    this.vao = gl.createVertexArray();
    this.emptyVao = gl.createVertexArray();
    this.buffers = {
      pos: gl.createBuffer(),
      norm: gl.createBuffer(),
      col: gl.createBuffer(),
      hi: gl.createBuffer(),
      sh: gl.createBuffer(),
      ao: gl.createBuffer(),
      flag: gl.createBuffer(),
    };

    // FBO resources
    this.fbo = gl.createFramebuffer();
    this.fboTex = gl.createTexture();
    this.fboDepth = gl.createRenderbuffer();
    this._ensureFbo(180, 135);
  }

  _ensureFbo(w, h) {
    w = Math.max(16, Math.round(w));
    h = Math.max(16, Math.round(h));
    if (w === this.fboW && h === this.fboH) return;
    this.fboW = w;
    this.fboH = h;
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindRenderbuffer(gl.RENDERBUFFER, this.fboDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fboDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.panning = e.shiftKey || e.button === 1;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.targetYaw = null;
      this.targetPitch = null;
      this.velYaw = 0;
      this.velPitch = 0;
    });

    c.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      if (this.panning) {
        const voxelsPerPx = (this.bounds.radius * 2.5) / (this.canvas.height * this.zoom);
        this.panX += dx * voxelsPerPx;
        this.panY -= dy * voxelsPerPx;
      } else {
        this.yawDeg = (this.yawDeg + dx * 0.65 + 360) % 360;
        this.pitchDeg = Math.max(-89, Math.min(89, this.pitchDeg + dy * 0.55));
        this.velYaw = dx * 0.25;
        this.velPitch = dy * 0.2;
      }
    });

    const endDrag = () => {
      this.dragging = false;
      this.panning = false;
    };
    c.addEventListener("pointerup", endDrag);
    c.addEventListener("pointercancel", endDrag);

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoom = Math.max(0.35, Math.min(4.0, this.zoom * factor));
      },
      { passive: false },
    );
  }

  snapTo(yawDeg, pitchDeg) {
    // Shortest angular path for smooth snap animation
    const cur = ((this.yawDeg % 360) + 360) % 360;
    let target = ((yawDeg % 360) + 360) % 360;
    let delta = target - cur;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    this.yawDeg = cur;
    this.targetYaw = cur + delta;
    this.targetPitch = Math.max(-89, Math.min(89, pitchDeg));
    this.velYaw = 0;
    this.velPitch = 0;
  }

  resetView() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.snapTo(315, 30);
  }

  // The camera actually rendered (and shown in the HUD / used by GIF export). Never mutates this.*.
  getRenderCamera() {
    return computeRenderCamera({
      yawDeg: this.yawDeg,
      pitchDeg: this.pitchDeg,
      panX: this.panX,
      panY: this.panY,
      zoom: this.zoom,
      pixelSnap: this.pixelSnap,
      snapStepDeg: this.snapStepDeg,
      pixelMode: this.pixelMode,
      radius: this.bounds.radius,
      fboW: this.fboW,
      fboH: this.fboH,
    });
  }

  uploadMesh(serialized) {
    if (!this.supported) return;
    const gl = this.gl;
    this.bounds = serialized.bounds;
    this.faceCount = serialized.faceCount;
    this.vertexCount = serialized.triangleCount * 3;

    const positions = new Float32Array(base64ToArrayBuffer(serialized.positionsB64));
    const normals = new Float32Array(base64ToArrayBuffer(serialized.normalsB64));
    const colors = new Uint8Array(base64ToArrayBuffer(serialized.colorsB64));
    const hiColors = new Uint8Array(base64ToArrayBuffer(serialized.highlightColorsB64));
    const shColors = new Uint8Array(base64ToArrayBuffer(serialized.shadowColorsB64));
    const ao = new Float32Array(base64ToArrayBuffer(serialized.aoB64));
    const flags = new Uint8Array(base64ToArrayBuffer(serialized.flagsB64));

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.norm);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.col);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.hi);
    gl.bufferData(gl.ARRAY_BUFFER, hiColors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.sh);
    gl.bufferData(gl.ARRAY_BUFFER, shColors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.ao);
    gl.bufferData(gl.ARRAY_BUFFER, ao, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.flag);
    gl.bufferData(gl.ARRAY_BUFFER, flags, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.UNSIGNED_BYTE, false, 0, 0);

    gl.bindVertexArray(null);
  }

  start() {
    if (!this.supported || this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this._step(dt);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }

  _step(dt) {
    if (this.targetYaw !== null && this.targetPitch !== null) {
      const k = 1 - Math.exp(-14 * dt);
      this.yawDeg += (this.targetYaw - this.yawDeg) * k;
      this.pitchDeg += (this.targetPitch - this.pitchDeg) * k;
      if (Math.abs(this.targetYaw - this.yawDeg) < 0.08 && Math.abs(this.targetPitch - this.pitchDeg) < 0.08) {
        this.yawDeg = ((this.targetYaw % 360) + 360) % 360;
        this.pitchDeg = this.targetPitch;
        this.targetYaw = null;
        this.targetPitch = null;
      }
    } else if (!this.dragging) {
      if (this.autoSpin) {
        this.yawDeg = (this.yawDeg + this.spinSpeed * dt + 360) % 360;
      } else if (Math.abs(this.velYaw) > 0.01 || Math.abs(this.velPitch) > 0.01) {
        this.yawDeg = (this.yawDeg + this.velYaw + 360) % 360;
        this.pitchDeg = Math.max(-89, Math.min(89, this.pitchDeg + this.velPitch));
        const damp = Math.exp(-9 * dt);
        this.velYaw *= damp;
        this.velPitch *= damp;
      }
    }
  }

  render() {
    if (!this.supported) return;
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const targetFboW = this.pixelMode === "pixelart" ? Math.max(32, Math.floor(cw / this.pixelSize)) : cw;
    const targetFboH = this.pixelMode === "pixelart" ? Math.max(32, Math.floor(ch / this.pixelSize)) : ch;
    this._ensureFbo(targetFboW, targetFboH);

    // Pass 1: Orthographic Voxel Geometry into offscreen FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const view = this.getRenderCamera();

    if (this.vertexCount > 0) {
      const cam = computeCameraBasis(view.yawDeg, view.pitchDeg);
      const lightDir =
        this.lightLock === "world"
          ? normalize3([-0.45, 0.35, 0.82])
          : normalize3([
              -0.42 * cam.right[0] + 0.68 * cam.up[0] + 0.60 * cam.forward[0],
              -0.42 * cam.right[1] + 0.68 * cam.up[1] + 0.60 * cam.forward[1],
              -0.42 * cam.right[2] + 0.68 * cam.up[2] + 0.60 * cam.forward[2],
            ]);

      gl.useProgram(this.geomProg);
      gl.uniform3f(this.uGeom.uCenter, this.bounds.centerX, this.bounds.centerY, this.bounds.centerZ);
      gl.uniform3fv(this.uGeom.uCamRight, cam.right);
      gl.uniform3fv(this.uGeom.uCamUp, cam.up);
      gl.uniform3fv(this.uGeom.uCamForward, cam.forward);
      gl.uniform2f(this.uGeom.uHalfView, view.halfW, view.halfH);
      gl.uniform2f(this.uGeom.uPan, view.panX, view.panY);
      gl.uniform1f(this.uGeom.uDepthScale, 1.0 / (this.bounds.radius * 2.5 + 1.0));
      gl.uniform3fv(this.uGeom.uLightDir, lightDir);
      gl.uniform1f(this.uGeom.uShading, this.shading ? 1.0 : 0.0);

      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      gl.bindVertexArray(null);
    }

    // Pass 2: Full-Screen Nearest-Neighbor Pixel-Art Blit + 1px Silhouette Outline + Emissive Glow
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    const theme = BG_THEMES[this.bgTheme] || BG_THEMES.night;
    gl.useProgram(this.postProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(this.uPost.uTex, 0);
    gl.uniform2i(this.uPost.uFboSize, this.fboW, this.fboH);
    gl.uniform3fv(this.uPost.uBgColor, theme.center);
    gl.uniform3fv(this.uPost.uBgEdgeColor, theme.edge);
    gl.uniform1f(this.uPost.uOutline, this.outline ? 1.0 : 0.0);
    gl.uniform1f(this.uPost.uShowGlow, 1.0);

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    if (this.onHudUpdate) {
      this.onHudUpdate({
        yawDeg: ((view.yawDeg % 360) + 360) % 360,
        pitchDeg: view.pitchDeg,
        pixelsPerVoxel: view.pixelsPerVoxel,
        fboW: this.fboW,
        fboH: this.fboH,
        faceCount: this.faceCount,
      });
    }
  }
}
