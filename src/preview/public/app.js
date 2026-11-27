import { VoxelTurntableViewport } from "./turntable.js";

const DIRS = ["se", "sw", "nw", "ne"];

const state = {
  activeTab: "turntable",
  assets: [],
  selectedAsset: "",
  selectedAnim: "",
  dirIdx: 0,
  frame: 0,
  zoom: 4,
  playing: false,
  layer: "main",
  outlineOverride: "",
  showGrid: true,
  showAnchor: true,
  ttFrame: 0,
  ttFrameCount: 1,
  ttPlayingAnim: false,
  room: null,
  sandboxAsset: "desk-dev-dual",
  sandboxAnim: "sit_type",
  sandboxDirIdx: 0,
  sandboxFrame: 0,
  sandboxPlaying: false,
  cacheBust: Date.now(),
};

const el = (id) => document.getElementById(id);

// --- 360° Smooth WebGL2 Turntable Viewport ---
let lastHudText = "";
const turntable = new VoxelTurntableViewport(el("turntable-canvas"), (info) => {
  const modeTag = turntable.pixelMode === "pixelart" ? `PIXELART (${info.fboW}×${info.fboH})` : "3D SMOOTH";
  const text = `Yaw ${info.yawDeg.toFixed(1)}° · Pitch ${info.pitchDeg.toFixed(1)}° · ${modeTag}`;
  if (text !== lastHudText) {
    lastHudText = text;
    el("tt-hud").textContent = text;
  }
});

const meshCache = new Map();

async function loadTurntableMesh(forceRefresh = false) {
  if (!state.selectedAsset) return;
  if (!turntable.supported) {
    el("tt-meta").textContent = "WebGL2 is unavailable in this browser.\nUse 2:1 Iso Inspector or Export 360° GIF.";
    return;
  }
  const key = `${state.selectedAsset}|${state.selectedAnim}|${state.ttFrame}|${state.cacheBust}`;
  let data = !forceRefresh ? meshCache.get(key) : null;
  if (!data) {
    const animQuery = state.selectedAnim ? `&anim=${encodeURIComponent(state.selectedAnim)}` : "";
    const url = `/api/mesh/${encodeURIComponent(state.selectedAsset)}?frame=${state.ttFrame}${animQuery}&t=${state.cacheBust}`;
    const res = await fetch(url);
    if (!res.ok) return;
    data = await res.json();
    if (meshCache.size > 64) meshCache.clear();
    meshCache.set(key, data);
  }
  state.ttFrameCount = data.frameCount || 1;
  turntable.uploadMesh(data.mesh);
  const b = data.mesh.bounds;
  el("tt-meta").textContent = [
    `id: ${data.id}`,
    `anim: ${data.anim} (${data.frameIndex + 1}/${data.frameCount})`,
    `faces: ${data.mesh.faceCount} (${data.mesh.triangleCount} tris)`,
    `size: ${(b.maxX - b.minX).toFixed(0)}×${(b.maxY - b.minY).toFixed(0)}×${(b.maxZ - b.minZ).toFixed(0)} vox`,
  ].join("\n");
}

function setActiveTab(tab) {
  state.activeTab = tab;
  for (const name of ["turntable", "inspector", "sandbox"]) {
    el(`tab-${name}`).classList.toggle("active", name === tab);
    el(`panel-${name}`).classList.toggle("active", name === tab);
  }
  if (tab === "turntable") {
    turntable.start();
    loadTurntableMesh();
  } else {
    turntable.stop();
    if (tab === "inspector") drawInspector();
    if (tab === "sandbox") drawSandbox();
  }
}

async function fetchAssets() {
  const res = await fetch("/api/assets");
  const data = await res.json();
  state.assets = data.assets || [];
  const select = el("asset-select");
  const ttSelect = el("tt-asset-select");
  const sbSelect = el("sandbox-asset-select");
  select.innerHTML = "";
  ttSelect.innerHTML = "";
  sbSelect.innerHTML = "";
  for (const a of state.assets) {
    const label = `${a.id} (${a.footprintTiles[0]}x${a.footprintTiles[1]})`;
    select.add(new Option(label, a.id));
    ttSelect.add(new Option(label, a.id));
    sbSelect.add(new Option(label, a.id));
  }
  if (!state.selectedAsset && state.assets.length > 0) {
    state.selectedAsset = state.assets.find((a) => a.id === "agent-dev")?.id ?? state.assets[0].id;
  }
  select.value = state.selectedAsset;
  ttSelect.value = state.selectedAsset;
  sbSelect.value = state.sandboxAsset;
  syncAnimOptions();
}

function syncAnimOptions() {
  const meta = state.assets.find((a) => a.id === state.selectedAsset);
  const animSel = el("anim-select");
  const ttAnimSel = el("tt-anim-select");
  animSel.innerHTML = "";
  ttAnimSel.innerHTML = "";
  const anims = meta?.animations || [];
  if (anims.length === 0) {
    animSel.add(new Option("default", ""));
    ttAnimSel.add(new Option("default", ""));
    state.selectedAnim = "";
  } else {
    for (const a of anims) {
      animSel.add(new Option(a, a));
      ttAnimSel.add(new Option(a, a));
    }
    if (!anims.includes(state.selectedAnim)) state.selectedAnim = anims[0];
    animSel.value = state.selectedAnim;
    ttAnimSel.value = state.selectedAnim;
  }
}

async function drawInspector() {
  if (!state.selectedAsset) return;
  const dir = DIRS[state.dirIdx];
  el("dir-label").textContent = dir.toUpperCase();
  el("frame-label").textContent = `Frame ${state.frame}`;
  el("zoom-val").textContent = String(state.zoom);

  const meta = state.assets.find((a) => a.id === state.selectedAsset);
  const frameCount =
    (state.selectedAnim && meta?.animationFrameCounts?.[state.selectedAnim]) || meta?.frameCount || 1;
  const scrubber = el("frame-range");
  scrubber.max = String(Math.max(0, frameCount - 1));
  scrubber.value = String(state.frame % frameCount);

  const outlineQuery = state.outlineOverride ? `&outline=${encodeURIComponent(state.outlineOverride)}` : "";
  const animQuery = state.selectedAnim ? `&anim=${encodeURIComponent(state.selectedAnim)}` : "";
  const url = `/api/render/${encodeURIComponent(state.selectedAsset)}?dir=${dir}&frame=${state.frame}&layer=${state.layer}${animQuery}${outlineQuery}&t=${state.cacheBust}`;
  const res = await fetch(url);
  if (!res.ok) return;

  const anchorX = Number(res.headers.get("x-pixcel-anchor-x") || 0);
  const anchorY = Number(res.headers.get("x-pixcel-anchor-y") || 0);
  const fp = (res.headers.get("x-pixcel-footprint") || "1,1").split(",").map(Number);
  const stepX = Number(res.headers.get("x-pixcel-step-x") || 32);
  const stepY = Number(res.headers.get("x-pixcel-step-y") || 16);

  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const canvas = el("inspector-canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const z = state.zoom;
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height * 0.72);
  const drawX = cx - anchorX * z;
  const drawY = cy - anchorY * z;

  if (state.showGrid) {
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 1;
    const [fx, fy] = fp;
    const topX = cx - (fx - fy) * stepX * z;
    const topY = cy - (fx + fy) * stepY * z;
    const rightX = topX + fx * stepX * z;
    const rightY = topY + fx * stepY * z;
    const leftX = topX - fy * stepX * z;
    const leftY = topY + fy * stepY * z;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.lineTo(rightX, rightY);
    ctx.lineTo(cx, cy);
    ctx.lineTo(leftX, leftY);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.drawImage(bmp, drawX, drawY, bmp.width * z, bmp.height * z);

  if (state.showAnchor) {
    ctx.strokeStyle = "#f59e0b";
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy);
    ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx, cy + 6);
    ctx.stroke();
  }

  el("asset-meta").textContent = [
    `id: ${state.selectedAsset}`,
    `dir: ${dir}`,
    `size: ${bmp.width}x${bmp.height}px`,
    `footprint: ${fp[0]}x${fp[1]} tiles`,
    `anchor: (${anchorX}, ${anchorY})`,
  ].join("\n");
}

async function fetchRoom() {
  const res = await fetch("/api/room");
  if (!res.ok) return;
  const data = await res.json();
  state.room = data.room;
  await drawSandbox();
}

async function drawSandbox() {
  if (!state.room) return;
  el("sandbox-dir").textContent = DIRS[state.sandboxDirIdx].toUpperCase();
  const res = await fetch("/api/room/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: state.room, frameIndex: state.sandboxFrame, emissiveMode: "baked" }),
  });
  if (!res.ok) return;
  const originX = Number(res.headers.get("x-pixcel-origin-x") || 0);
  const originY = Number(res.headers.get("x-pixcel-origin-y") || 0);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const canvas = el("sandbox-canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(1, Math.min(2, Math.floor(Math.min(canvas.width / bmp.width, canvas.height / bmp.height))));
  const dx = Math.floor((canvas.width - bmp.width * scale) / 2);
  const dy = Math.floor((canvas.height - bmp.height * scale) / 2);
  ctx.drawImage(bmp, dx, dy, bmp.width * scale, bmp.height * scale);
  state.sandboxTransform = { dx, dy, scale, originX, originY };

  el("sandbox-meta").textContent = [
    `room: ${state.room.id}`,
    `tiles: ${state.room.widthTiles}x${state.room.depthTiles}`,
    `objects: ${state.room.objects.length}`,
    `render: ${bmp.width}x${bmp.height}px (${scale}x)`,
  ].join("\n");
}

// Tabs
el("tab-turntable").onclick = () => setActiveTab("turntable");
el("tab-inspector").onclick = () => setActiveTab("inspector");
el("tab-sandbox").onclick = () => setActiveTab("sandbox");

// Turntable controls
el("tt-asset-select").onchange = (e) => {
  state.selectedAsset = e.target.value;
  el("asset-select").value = state.selectedAsset;
  state.frame = 0;
  state.ttFrame = 0;
  syncAnimOptions();
  loadTurntableMesh();
};
el("tt-anim-select").onchange = (e) => {
  state.selectedAnim = e.target.value;
  el("anim-select").value = state.selectedAnim;
  state.frame = 0;
  state.ttFrame = 0;
  loadTurntableMesh();
};
el("btn-mode-pixelart").onclick = () => {
  turntable.pixelMode = "pixelart";
  el("btn-mode-pixelart").classList.add("active");
  el("btn-mode-3d").classList.remove("active");
};
el("btn-mode-3d").onclick = () => {
  turntable.pixelMode = "3d";
  el("btn-mode-3d").classList.add("active");
  el("btn-mode-pixelart").classList.remove("active");
};
el("tt-px-range").oninput = (e) => {
  turntable.pixelSize = Number(e.target.value);
  el("tt-px-val").textContent = String(turntable.pixelSize);
};
el("tt-zoom-range").oninput = (e) => {
  turntable.zoom = Number(e.target.value) / 100;
  el("tt-zoom-val").textContent = turntable.zoom.toFixed(1);
};
el("tt-speed-range").oninput = (e) => {
  turntable.spinSpeed = Number(e.target.value);
  el("tt-speed-val").textContent = String(turntable.spinSpeed);
};
el("btn-tt-spin").onclick = () => {
  turntable.autoSpin = !turntable.autoSpin;
  el("btn-tt-spin").textContent = turntable.autoSpin ? "⏸ Stop Spin" : "▶ Spin 360°";
};

let ttAnimTimer = null;
el("btn-tt-anim").onclick = () => {
  state.ttPlayingAnim = !state.ttPlayingAnim;
  el("btn-tt-anim").textContent = state.ttPlayingAnim ? "⏸ Pause Clip" : "▶ Play Clip";
  if (ttAnimTimer) clearInterval(ttAnimTimer);
  if (state.ttPlayingAnim) {
    ttAnimTimer = setInterval(() => {
      state.ttFrame = (state.ttFrame + 1) % Math.max(1, state.ttFrameCount);
      loadTurntableMesh();
    }, 280);
  }
};
el("chk-tt-outline").onchange = (e) => {
  turntable.outline = e.target.checked;
};
el("chk-tt-shading").onchange = (e) => {
  turntable.shading = e.target.checked;
};
el("tt-light-select").onchange = (e) => {
  turntable.lightLock = e.target.value;
};
el("tt-bg-select").onchange = (e) => {
  turntable.bgTheme = e.target.value;
};
el("btn-tt-reset").onclick = () => {
  turntable.resetView();
  el("tt-zoom-range").value = "100";
  el("tt-zoom-val").textContent = "1.0";
};

for (const btn of document.querySelectorAll(".snap-btn[data-yaw]")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".snap-btn[data-yaw]")) b.classList.remove("active");
    btn.classList.add("active");
    turntable.autoSpin = false;
    el("btn-tt-spin").textContent = "▶ Spin 360°";
    turntable.snapTo(Number(btn.dataset.yaw), Number(btn.dataset.pitch));
  });
}

el("btn-tt-export-gif").onclick = () => {
  if (!state.selectedAsset) return;
  const animQ = state.selectedAnim ? `&anim=${encodeURIComponent(state.selectedAnim)}` : "";
  const outlineQ = turntable.outline ? "silhouette" : "none";
  const shadingQ = turntable.shading ? "1" : "0";
  const pitch = Math.round(turntable.pitchDeg);
  const url = `/api/turntable/${encodeURIComponent(state.selectedAsset)}?frames=36&pitch=${pitch}&fps=18&outline=${outlineQ}&shading=${shadingQ}&light=${turntable.lightLock}${animQ}&frame=${state.ttFrame}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.selectedAsset}-360.gif`;
  a.click();
  el("live-status").textContent = `Exporting ${state.selectedAsset}-360.gif...`;
};

// Inspector controls
el("asset-select").onchange = (e) => {
  state.selectedAsset = e.target.value;
  el("tt-asset-select").value = state.selectedAsset;
  state.frame = 0;
  state.ttFrame = 0;
  syncAnimOptions();
  drawInspector();
};
el("anim-select").onchange = (e) => {
  state.selectedAnim = e.target.value;
  el("tt-anim-select").value = state.selectedAnim;
  state.frame = 0;
  state.ttFrame = 0;
  drawInspector();
};
el("btn-rot-l").onclick = () => {
  state.dirIdx = (state.dirIdx + 3) % 4;
  drawInspector();
};
el("btn-rot-r").onclick = () => {
  state.dirIdx = (state.dirIdx + 1) % 4;
  drawInspector();
};
el("zoom-range").oninput = (e) => {
  state.zoom = Number(e.target.value);
  drawInspector();
};
el("frame-range").oninput = (e) => {
  state.frame = Number(e.target.value);
  drawInspector();
};
el("outline-select").onchange = (e) => {
  state.outlineOverride = e.target.value;
  drawInspector();
};
el("emissive-select").onchange = (e) => {
  state.layer = e.target.value;
  drawInspector();
};
el("chk-grid").onchange = (e) => {
  state.showGrid = e.target.checked;
  drawInspector();
};
el("chk-anchor").onchange = (e) => {
  state.showAnchor = e.target.checked;
  drawInspector();
};

let playTimer = null;
el("btn-play").onclick = () => {
  state.playing = !state.playing;
  el("btn-play").textContent = state.playing ? "⏸ Pause" : "▶ Play";
  if (playTimer) clearInterval(playTimer);
  if (state.playing) {
    playTimer = setInterval(() => {
      const meta = state.assets.find((a) => a.id === state.selectedAsset);
      const count =
        (state.selectedAnim && meta?.animationFrameCounts?.[state.selectedAnim]) || meta?.frameCount || 1;
      state.frame = (state.frame + 1) % count;
      drawInspector();
    }, 300);
  }
};

// Sandbox controls
el("sandbox-asset-select").onchange = (e) => {
  state.sandboxAsset = e.target.value;
};
el("sandbox-anim-select").onchange = (e) => {
  state.sandboxAnim = e.target.value;
};
el("btn-sandbox-rot").onclick = () => {
  state.sandboxDirIdx = (state.sandboxDirIdx + 1) % 4;
  drawSandbox();
};
let sbTimer = null;
el("btn-sandbox-play").onclick = () => {
  state.sandboxPlaying = !state.sandboxPlaying;
  el("btn-sandbox-play").textContent = state.sandboxPlaying ? "⏸ Stop" : "▶ Animate";
  if (sbTimer) clearInterval(sbTimer);
  if (state.sandboxPlaying) {
    sbTimer = setInterval(() => {
      state.sandboxFrame = (state.sandboxFrame + 1) % 12;
      drawSandbox();
    }, 350);
  }
};
el("btn-sandbox-load").onclick = async () => {
  const file = el("room-file-input").value.trim();
  const q = file ? `?file=${encodeURIComponent(file)}` : "";
  const res = await fetch(`/api/room${q}`);
  if (res.ok) {
    const data = await res.json();
    state.room = data.room;
    el("live-status").textContent = `Loaded ${data.file}`;
    await drawSandbox();
  } else {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    el("live-status").textContent = `Load error: ${err.error}`;
  }
};
el("btn-sandbox-save").onclick = async () => {
  if (!state.room) return;
  const file = el("room-file-input").value.trim() || "custom-office.room.json";
  const res = await fetch("/api/room", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file, room: state.room }),
  });
  if (res.ok) {
    el("live-status").textContent = `Saved ${file}`;
  } else {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    el("live-status").textContent = `Save error: ${err.error}`;
  }
};

// Sandbox canvas click-to-place & right-click-to-erase
function screenToTile(evt) {
  if (!state.room || !state.sandboxTransform) return null;
  const canvas = el("sandbox-canvas");
  const rect = canvas.getBoundingClientRect();
  const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const py = (evt.clientY - rect.top) * (canvas.height / rect.height);
  const { dx, dy, scale, originX, originY } = state.sandboxTransform;
  const imgX = (px - dx) / scale;
  const imgY = (py - dy) / scale;
  const stepX = state.room.tilePreset === "32x16" ? 16 : 32;
  const stepY = state.room.tilePreset === "32x16" ? 8 : state.room.tilePreset === "64x31" ? 15 : 16;
  const rx = (imgX - originX) / stepX;
  const ry = (imgY - (originY - stepY)) / stepY;
  const tx = Math.floor((rx + ry) / 2 + 0.5);
  const ty = Math.floor((ry - rx) / 2 + 0.5);
  if (tx < 0 || ty < 0 || tx >= state.room.widthTiles || ty >= state.room.depthTiles) return null;
  return { tx, ty };
}

el("sandbox-canvas").addEventListener("click", (evt) => {
  const tile = screenToTile(evt);
  if (!tile || !state.room) return;
  const meta = state.assets.find((a) => a.id === state.sandboxAsset);
  const dir = DIRS[state.sandboxDirIdx];
  if (meta?.layer === "floor") {
    state.room.floors = state.room.floors.filter((f) => !(f.tx === tile.tx && f.ty === tile.ty));
    state.room.floors.push({ assetId: state.sandboxAsset, tx: tile.tx, ty: tile.ty, direction: dir });
  } else if (meta?.layer === "wall") {
    const edge = tile.tx === 0 && tile.ty === 0 ? "corner" : tile.tx === 0 ? "nw" : "ne";
    state.room.walls.push({ assetId: state.sandboxAsset, tx: tile.tx, ty: tile.ty, edge });
  } else if (meta?.layer === "wall-decor") {
    const edge = tile.tx === 0 ? "nw" : "ne";
    state.room.wallDecor.push({ assetId: state.sandboxAsset, tx: tile.tx, ty: tile.ty, edge });
  } else if (meta?.category === "character") {
    state.room.characters = state.room.characters || [];
    state.room.characters.push({
      assetId: state.sandboxAsset,
      tx: tile.tx,
      ty: tile.ty,
      direction: dir,
      animation: state.sandboxAnim || "idle",
    });
  } else {
    state.room.objects.push({ assetId: state.sandboxAsset, tx: tile.tx, ty: tile.ty, direction: dir });
  }
  drawSandbox();
});

el("sandbox-canvas").addEventListener("contextmenu", (evt) => {
  evt.preventDefault();
  const tile = screenToTile(evt);
  if (!tile || !state.room) return;
  const beforeChars = (state.room.characters || []).length;
  state.room.characters = (state.room.characters || []).filter((c) => !(c.tx === tile.tx && c.ty === tile.ty));
  if (state.room.characters.length === beforeChars) {
    state.room.objects = state.room.objects.filter((o) => !(o.tx === tile.tx && o.ty === tile.ty));
  }
  drawSandbox();
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (state.activeTab === "turntable") {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      turntable.snapTo(turntable.yawDeg - 15, turntable.pitchDeg);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      turntable.snapTo(turntable.yawDeg + 15, turntable.pitchDeg);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      turntable.snapTo(turntable.yawDeg, turntable.pitchDeg + 10);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      turntable.snapTo(turntable.yawDeg, turntable.pitchDeg - 10);
    } else if (e.key === " ") {
      e.preventDefault();
      el("btn-tt-spin").click();
    }
    return;
  }
  if (e.key === "q" || e.key === "Q") {
    state.dirIdx = (state.dirIdx + 3) % 4;
    drawInspector();
  } else if (e.key === "e" || e.key === "E") {
    state.dirIdx = (state.dirIdx + 1) % 4;
    drawInspector();
  } else if (e.key === "r" || e.key === "R") {
    state.sandboxDirIdx = (state.sandboxDirIdx + 1) % 4;
    drawSandbox();
  }
});

// SSE live reload
const sse = new EventSource("/api/events");
sse.addEventListener("reload", async () => {
  state.cacheBust = Date.now();
  meshCache.clear();
  el("live-status").textContent = `Reloaded ${new Date().toLocaleTimeString()}`;
  await fetchAssets();
  if (state.activeTab === "turntable") await loadTurntableMesh(true);
  await drawInspector();
  await drawSandbox();
});

await fetchAssets();
setActiveTab("turntable");
await fetchRoom();
