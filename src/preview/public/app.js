const DIRS = ["se", "sw", "nw", "ne"];

const state = {
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
  room: null,
  sandboxAsset: "desk-dev-dual",
  sandboxAnim: "sit_type",
  sandboxDirIdx: 0,
  sandboxFrame: 0,
  sandboxPlaying: false,
  cacheBust: Date.now(),
};

const el = (id) => document.getElementById(id);

async function fetchAssets() {
  const res = await fetch("/api/assets");
  const data = await res.json();
  state.assets = data.assets || [];
  const select = el("asset-select");
  const sbSelect = el("sandbox-asset-select");
  select.innerHTML = "";
  sbSelect.innerHTML = "";
  for (const a of state.assets) {
    const opt = new Option(`${a.id} (${a.footprintTiles[0]}x${a.footprintTiles[1]})`, a.id);
    select.add(opt);
    sbSelect.add(opt.cloneNode(true));
  }
  if (!state.selectedAsset && state.assets.length > 0) {
    state.selectedAsset = state.assets.find((a) => a.id === "agent-dev")?.id ?? state.assets[0].id;
  }
  select.value = state.selectedAsset;
  sbSelect.value = state.sandboxAsset;
  syncAnimOptions();
}

function syncAnimOptions() {
  const meta = state.assets.find((a) => a.id === state.selectedAsset);
  const animSel = el("anim-select");
  animSel.innerHTML = "";
  const anims = meta?.animations || [];
  if (anims.length === 0) {
    animSel.add(new Option("default", ""));
    state.selectedAnim = "";
  } else {
    for (const a of anims) animSel.add(new Option(a, a));
    if (!anims.includes(state.selectedAnim)) state.selectedAnim = anims[0];
    animSel.value = state.selectedAnim;
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
    // Bottom diamond corner is at (cx, cy)
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
el("tab-inspector").onclick = () => {
  el("tab-inspector").classList.add("active");
  el("tab-sandbox").classList.remove("active");
  el("panel-inspector").classList.add("active");
  el("panel-sandbox").classList.remove("active");
  drawInspector();
};
el("tab-sandbox").onclick = () => {
  el("tab-sandbox").classList.add("active");
  el("tab-inspector").classList.remove("active");
  el("panel-sandbox").classList.add("active");
  el("panel-inspector").classList.remove("active");
  drawSandbox();
};

// Inspector controls
el("asset-select").onchange = (e) => {
  state.selectedAsset = e.target.value;
  state.frame = 0;
  syncAnimOptions();
  drawInspector();
};
el("anim-select").onchange = (e) => {
  state.selectedAnim = e.target.value;
  state.frame = 0;
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
  el("live-status").textContent = `Reloaded ${new Date().toLocaleTimeString()}`;
  await fetchAssets();
  await drawInspector();
  await drawSandbox();
});

await fetchAssets();
await drawInspector();
await fetchRoom();
