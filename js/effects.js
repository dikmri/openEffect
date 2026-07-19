// エフェクト定義レジストリ + Canvas による実装
import { rgba } from './utils.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
// src を新規キャンバに加工して返す
function process(src, fn, w = src.width, h = src.height) {
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  fn(ctx);
  return out;
}
// src を指定フィルタで描画
function withFilter(src, filter) {
  return process(src, ctx => {
    ctx.filter = filter;
    ctx.drawImage(src, 0, 0);
  });
}

export const EFFECTS = [
  {
    id: 'gaussianBlur', name: 'ガウスぼかし', cat: 'ぼかし・シャープ',
    params: [
      { key: 'blurriness', label: 'ぼかし', type: 'slider', min: 0, max: 500, def: 20, step: 0.1 },
      { key: 'repeat', label: 'エッジピクセルを繰り返す', type: 'checkbox', def: true },
    ],
    apply(src, p) {
      const b = Math.max(0, +p.blurriness || 0);
      if (b === 0) return src;
      return withFilter(src, `blur(${b}px)`);
    },
  },
  {
    id: 'boxBlur', name: '高速ボックスぼかし', cat: 'ぼかし・シャープ',
    params: [
      { key: 'blurriness', label: 'ぼかしの半径', type: 'slider', min: 0, max: 300, def: 10, step: 0.1 },
      { key: 'iterations', label: '繰り返し', type: 'slider', min: 1, max: 5, def: 2, step: 1 },
    ],
    apply(src, p) {
      const b = Math.max(0, +p.blurriness || 0);
      const n = Math.max(1, Math.round(+p.iterations || 1));
      if (b === 0) return src;
      let cur = src;
      for (let i = 0; i < n; i++) cur = withFilter(cur, `blur(${b / n}px)`);
      return cur;
    },
  },
  {
    id: 'dropShadow', name: 'ドロップシャドウ', cat: 'パースペクティブ',
    params: [
      { key: 'color', label: 'シャドウの色', type: 'color', def: '#000000' },
      { key: 'opacity', label: '不透明度', type: 'slider', min: 0, max: 100, def: 50, step: 1, unit: '%' },
      { key: 'angle', label: '角度', type: 'slider', min: -180, max: 180, def: 135, step: 1, unit: '°' },
      { key: 'distance', label: '距離', type: 'slider', min: 0, max: 500, def: 12, step: 0.5 },
      { key: 'softness', label: 'ぼかし', type: 'slider', min: 0, max: 500, def: 12, step: 0.5 },
    ],
    apply(src, p) {
      const dist = +p.distance || 0, soft = +p.softness || 0;
      const pad = Math.ceil(dist + soft * 2 + 2);
      const rad = ((+p.angle || 0) - 90) * Math.PI / 180; // AE: 135° = 右下
      const dx = Math.cos(rad) * dist, dy = Math.sin(rad) * dist;
      // ソースを色で塗りつぶした影
      const shadow = process(src, ctx => {
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = p.color || '#000';
        ctx.fillRect(0, 0, src.width, src.height);
      });
      const out = process(src, ctx => {
        ctx.filter = soft > 0 ? `blur(${soft}px)` : 'none';
        ctx.globalAlpha = Math.max(0, Math.min(1, (+p.opacity ?? 50) / 100));
        ctx.drawImage(shadow, pad + dx, pad + dy);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.drawImage(src, pad, pad);
      }, src.width + pad * 2, src.height + pad * 2);
      return { canvas: out, dx: -pad, dy: -pad };
    },
  },
  {
    id: 'glow', name: 'グロー', cat: 'スタイライズ',
    params: [
      { key: 'radius', label: 'グローの半径', type: 'slider', min: 0, max: 300, def: 25, step: 0.5 },
      { key: 'intensity', label: 'グローの強度', type: 'slider', min: 0, max: 4, def: 1, step: 0.05 },
    ],
    apply(src, p) {
      const r = Math.max(0, +p.radius || 0);
      const inten = Math.max(0, +p.intensity ?? 1);
      if (r === 0 || inten === 0) return src;
      const pad = Math.ceil(r * 2 + 2);
      const blurred = process(src, ctx => {
        ctx.filter = `blur(${r}px)`;
        ctx.drawImage(src, pad, pad);
      }, src.width + pad * 2, src.height + pad * 2);
      const out = process(src, ctx => {
        ctx.drawImage(blurred, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, inten);
        ctx.drawImage(blurred, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(src, pad, pad);
      }, blurred.width, blurred.height);
      return { canvas: out, dx: -pad, dy: -pad };
    },
  },
  {
    id: 'fill', name: '塗りつぶし', cat: '生成',
    params: [
      { key: 'color', label: 'カラー', type: 'color', def: '#ff0000' },
      { key: 'mix', label: '元の画像と混合', type: 'slider', min: 0, max: 100, def: 0, step: 1, unit: '%' },
    ],
    apply(src, p) {
      return process(src, ctx => {
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = p.color || '#f00';
        ctx.fillRect(0, 0, src.width, src.height);
        const mix = Math.max(0, Math.min(100, +p.mix || 0)) / 100;
        if (mix > 0) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = mix;
          ctx.drawImage(src, 0, 0);
        }
      });
    },
  },
  {
    id: 'hueSat', name: '色相 / 彩度', cat: 'カラーコレクション',
    params: [
      { key: 'hue', label: 'マスター色相', type: 'slider', min: -180, max: 180, def: 0, step: 1, unit: '°' },
      { key: 'sat', label: 'マスター彩度', type: 'slider', min: -100, max: 100, def: 0, step: 1 },
      { key: 'light', label: 'マスター輝度', type: 'slider', min: -100, max: 100, def: 0, step: 1 },
    ],
    apply(src, p) {
      const f = `hue-rotate(${+p.hue || 0}deg) saturate(${100 + (+p.sat || 0)}%) brightness(${100 + (+p.light || 0)}%)`;
      return withFilter(src, f);
    },
  },
  {
    id: 'brightnessContrast', name: '輝度・コントラスト', cat: 'カラーコレクション',
    params: [
      { key: 'brightness', label: '輝度', type: 'slider', min: -100, max: 100, def: 0, step: 1 },
      { key: 'contrast', label: 'コントラスト', type: 'slider', min: -100, max: 100, def: 0, step: 1 },
    ],
    apply(src, p) {
      return withFilter(src, `brightness(${100 + (+p.brightness || 0)}%) contrast(${100 + (+p.contrast || 0)}%)`);
    },
  },
  {
    id: 'invert', name: '反転', cat: 'カラーコレクション',
    params: [
      { key: 'mix', label: '元の画像と混合', type: 'slider', min: 0, max: 100, def: 0, step: 1, unit: '%' },
    ],
    apply(src, p) {
      const inv = withFilter(src, 'invert(100%)');
      const mix = Math.max(0, Math.min(100, +p.mix || 0)) / 100;
      if (mix === 0) return inv;
      return process(src, ctx => {
        ctx.drawImage(inv, 0, 0);
        ctx.globalAlpha = mix;
        ctx.drawImage(src, 0, 0);
      });
    },
  },
  {
    id: 'mosaic', name: 'モザイク', cat: 'スタイライズ',
    params: [
      { key: 'hBlocks', label: '水平ブロック', type: 'slider', min: 1, max: 200, def: 12, step: 1 },
      { key: 'vBlocks', label: '垂直ブロック', type: 'slider', min: 1, max: 200, def: 12, step: 1 },
    ],
    apply(src, p) {
      const hb = Math.max(1, Math.round(+p.hBlocks || 12));
      const vb = Math.max(1, Math.round(+p.vBlocks || 12));
      const tiny = process(src, ctx => ctx.drawImage(src, 0, 0, hb, vb), hb, vb);
      return process(src, ctx => {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, src.width, src.height);
      });
    },
  },
  {
    id: 'transformFx', name: 'トランスフォーム', cat: 'ディストーション',
    params: [
      { key: 'posX', label: '位置 X', type: 'number', def: 0, step: 1 },
      { key: 'posY', label: '位置 Y', type: 'number', def: 0, step: 1 },
      { key: 'scaleX', label: 'スケール X', type: 'slider', min: -300, max: 300, def: 100, step: 1, unit: '%' },
      { key: 'scaleY', label: 'スケール Y', type: 'slider', min: -300, max: 300, def: 100, step: 1, unit: '%' },
      { key: 'rotation', label: '回転', type: 'slider', min: -180, max: 180, def: 0, step: 1, unit: '°' },
      { key: 'opacity', label: '不透明度', type: 'slider', min: 0, max: 100, def: 100, step: 1, unit: '%' },
    ],
    apply(src, p) {
      return process(src, ctx => {
        ctx.globalAlpha = Math.max(0, Math.min(1, (+p.opacity ?? 100) / 100));
        ctx.translate(src.width / 2 + (+p.posX || 0), src.height / 2 + (+p.posY || 0));
        ctx.rotate((+p.rotation || 0) * Math.PI / 180);
        ctx.scale((+p.scaleX ?? 100) / 100, (+p.scaleY ?? 100) / 100);
        ctx.drawImage(src, -src.width / 2, -src.height / 2);
      });
    },
  },
];

export function getEffectDef(id) {
  return EFFECTS.find(e => e.id === id) || null;
}
export function defaultParams(effectId) {
  const def = getEffectDef(effectId);
  const params = {};
  if (def) def.params.forEach(p => params[p.key] = p.def);
  return params;
}
// エフェクトを順に適用。{canvas, dx, dy} を返す (dx,dy は描画原点オフセット)
export function applyEffectsChain(srcCanvas, layer) {
  let cur = srcCanvas, dx = 0, dy = 0;
  for (const fx of layer.effects || []) {
    if (!fx.enabled) continue;
    const def = getEffectDef(fx.effectId);
    if (!def) continue;
    try {
      const r = def.apply(cur, fx.params);
      if (r && r.canvas) { dx += r.dx || 0; dy += r.dy || 0; cur = r.canvas; }
      else if (r) cur = r;
    } catch (e) { console.warn('エフェクト適用エラー', fx.effectId, e); }
  }
  return { canvas: cur, dx, dy };
}
export const EFFECT_CATEGORIES = [...new Set(EFFECTS.map(e => e.cat))];
