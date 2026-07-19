// フレームレンダラー: キーフレーム評価 + レイヤー合成
import { lerpValue, clamp } from './utils.js';
import { getItem } from './state.js';
import { applyEffectsChain } from './effects.js';

// ---- キーフレーム評価 ----
export function evalProp(layer, prop, time) {
  const kfs = layer.kf[prop];
  if (!kfs || kfs.length === 0) return layer.transform[prop];
  if (time <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (time >= a.time && time <= b.time) {
      let t = (time - a.time) / (b.time - a.time);
      if (b.ease === 'ease') t = t * t * (3 - 2 * t);
      return lerpValue(a.value, b.value, t);
    }
  }
  return last.value;
}
export function evalTransform(layer, time) {
  return {
    anchor: evalProp(layer, 'anchor', time),
    position: evalProp(layer, 'position', time),
    scale: evalProp(layer, 'scale', time),
    rotation: evalProp(layer, 'rotation', time),
    opacity: evalProp(layer, 'opacity', time),
  };
}

// ---- メディア管理 (ランタイム) ----
export function ensureMedia(item, onReady) {
  if (!item || item.mainType !== 'footage') return null;
  if (item.kind === 'image') {
    if (item._img) return item._img.complete && item._img.naturalWidth ? item._img : null;
    const img = new Image();
    img.onload = () => { item.width = img.naturalWidth; item.height = img.naturalHeight; onReady && onReady(); };
    img.src = item.src;
    item._img = img;
    return null;
  }
  if (item.kind === 'video') {
    if (item._video) return item._video;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = item.src;
    v.addEventListener('loadedmetadata', () => {
      item.width = v.videoWidth; item.height = v.videoHeight; item.duration = v.duration;
      onReady && onReady();
    });
    item._video = v;
    return v;
  }
  return null;
}

// ---- テキスト計測 ----
let measureCtx = null;
export function textFont(t) {
  return `${t.fontSize}px ${t.fontFamily || "'Segoe UI', 'Meiryo', sans-serif"}`;
}
export function measureText(t) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = textFont(t);
  const m = measureCtx.measureText(t.content || '');
  const asc = m.actualBoundingBoxAscent || t.fontSize * 0.8;
  const desc = m.actualBoundingBoxDescent || t.fontSize * 0.25;
  return { w: Math.max(1, m.width), h: asc + desc, asc, desc };
}

// ---- レイヤーコンテンツサイズ ----
export function contentSize(layer, comp) {
  switch (layer.type) {
    case 'footage': {
      const item = getItem(layer.sourceId);
      return { w: item?.width || comp.width, h: item?.height || comp.height };
    }
    case 'solid': {
      const item = getItem(layer.sourceId);
      return { w: item?.width || comp.width, h: item?.height || comp.height };
    }
    case 'text': {
      const m = measureText(layer.text);
      return { w: m.w, h: m.h };
    }
    case 'shape':
      return { w: layer.shape.width, h: layer.shape.height };
    default:
      return { w: comp.width, h: comp.height };
  }
}

// ---- レイヤーコンテンツ描画 (ローカル座標 0,0〜w,h) ----
export function renderLayerContent(layer, comp, time, res = 1) {
  const { w, h } = contentSize(layer, comp);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * res));
  c.height = Math.max(1, Math.round(h * res));
  const ctx = c.getContext('2d');
  ctx.scale(res, res);

  if (layer.type === 'footage') {
    const item = getItem(layer.sourceId);
    const media = ensureMedia(item);
    if (item?.kind === 'video' && item._video) {
      const v = item._video;
      const target = clamp((layer.offset || 0) + (time - layer.inTime), 0, (item.duration || 0));
      if (Math.abs(v.currentTime - target) > 0.08) {
        try { v.currentTime = target; } catch (e) { /* seek不可時は現フレーム */ }
      }
      if (v.readyState >= 2) ctx.drawImage(v, 0, 0, w, h);
    } else if (item?.kind === 'image' && item._img && item._img.complete) {
      ctx.drawImage(item._img, 0, 0, w, h);
    }
  } else if (layer.type === 'solid') {
    const item = getItem(layer.sourceId);
    ctx.fillStyle = item?.color || '#888';
    ctx.fillRect(0, 0, w, h);
  } else if (layer.type === 'text') {
    const t = layer.text;
    const m = measureText(t);
    ctx.font = textFont(t);
    ctx.fillStyle = t.fillColor || '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t.content || '', 0, m.asc);
  } else if (layer.type === 'shape') {
    const s = layer.shape;
    ctx.beginPath();
    if (s.kind === 'ellipse') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(0, 0, w, h);
    if (s.fillColor) { ctx.fillStyle = s.fillColor; ctx.fill(); }
    if (s.strokeColor && s.strokeWidth > 0) {
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = s.strokeWidth;
      ctx.stroke();
    }
  }
  return c;
}

// ---- 可視判定 ----
export function isLayerVisible(layer, time, soloActive) {
  if (!layer.enabled) return false;
  if (soloActive && !layer.solo) return false;
  return time >= layer.inTime && time < layer.outTime;
}

// ---- コンポジション全体をオフスクリーンにレンダリング ----
export function renderCompToCanvas(comp, time, res = 1) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(comp.width * res));
  out.height = Math.max(1, Math.round(comp.height * res));
  const ctx = out.getContext('2d');
  ctx.scale(res, res);
  ctx.fillStyle = comp.bgColor || '#000';
  ctx.fillRect(0, 0, comp.width, comp.height);

  const soloActive = comp.layers.some(l => l.solo && l.enabled);
  // 配列末尾が最背面 → 末尾から描画
  for (let i = comp.layers.length - 1; i >= 0; i--) {
    const layer = comp.layers[i];
    if (!isLayerVisible(layer, time, soloActive)) continue;
    const tr = evalTransform(layer, time);
    let content = renderLayerContent(layer, comp, time, res);
    let dx = 0, dy = 0;
    if (layer.effects?.length) {
      const r = applyEffectsChain(content, layer);
      content = r.canvas; dx = r.dx; dy = r.dy;
    }
    ctx.save();
    try { ctx.globalCompositeOperation = BLEND_MAP[layer.blendMode] || 'source-over'; } catch (e) { /* noop */ }
    ctx.globalAlpha = clamp((tr.opacity ?? 100) / 100, 0, 1);
    ctx.translate(tr.position.x, tr.position.y);
    ctx.rotate((tr.rotation || 0) * Math.PI / 180);
    ctx.scale((tr.scale?.x ?? 100) / 100, (tr.scale?.y ?? 100) / 100);
    ctx.translate(-tr.anchor.x + dx / res, -tr.anchor.y + dy / res);
    ctx.drawImage(content, 0, 0, content.width / res, content.height / res);
    ctx.restore();
  }
  return out;
}

export const BLEND_MAP = {
  'normal': 'source-over',
  'add': 'lighter',
  'screen': 'screen',
  'multiply': 'multiply',
  'overlay': 'overlay',
  'lighten': 'lighten',
  'darken': 'darken',
  'difference': 'difference',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
};
export const BLEND_MODES = [
  ['normal', '通常'], ['add', '加算'], ['screen', 'スクリーン'], ['multiply', '乗算'],
  ['overlay', 'オーバーレイ'], ['lighten', '比較(明)'], ['darken', '比較(暗)'],
  ['difference', '差の絶対値'], ['color-dodge', '覆い焼きカラー'], ['color-burn', '焼き込みカラー'],
  ['hard-light', 'ハードライト'], ['soft-light', 'ソフトライト'],
];
