// 汎用ユーティリティ
export function uid() {
  return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

const pad = (n, l = 2) => String(n).padStart(l, '0');

export function framesToTimecode(frames, fps) {
  frames = Math.max(0, Math.round(frames));
  const f = Math.floor(frames % fps);
  const s = Math.floor(frames / fps) % 60;
  const m = Math.floor(frames / (fps * 60)) % 60;
  const h = Math.floor(frames / (fps * 3600));
  return `${h}:${pad(m)}:${pad(s)}:${pad(f)}`;
}
export function secondsToTimecode(sec, fps) {
  return framesToTimecode(Math.floor(sec * fps + 1e-6), fps);
}
// デュレーション等の表示用 (四捨五入: 10s@29.97 → 0:00:10:00)
export function durationToTimecode(sec, fps) {
  return framesToTimecode(Math.round(sec * fps), fps);
}
// "0:00:10:00" 形式または秒数値文字列("10")を秒に変換。失敗時 null
export function timecodeToSeconds(str, fps) {
  str = String(str).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const parts = str.split(/[;:]/).map(Number);
  if (parts.some(isNaN) || parts.length < 2 || parts.length > 4) return null;
  while (parts.length < 4) parts.unshift(0);
  const [h, m, s, f] = parts;
  return h * 3600 + m * 60 + s + f / fps;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// DOM 生成ヘルパー
export function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'style') e.setAttribute('style', v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k === 'disabled') e.disabled = !!v;
    else if (k === 'selected') { if (v) e.selected = true; }
    else if (k === 'multiple') { if (v) e.multiple = true; }
    else e.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c);
  }
  return e;
}

export function cloneDeep(o) {
  return JSON.parse(JSON.stringify(o));
}

// 値が {x,y} か数値かを吸収して線形補間
export function lerpValue(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
