// プロジェクトへの全変更操作 (Undo スナップショット + イベント発行を一元管理)
import { uid, clamp, cloneDeep } from './utils.js';
import {
  state, emit, getComp, getItem, getLayer, selectedLayers,
  snapshot, makeLayer, makeComp, selectLayers, setTime,
} from './state.js';
import { measureText, contentSize } from './render.js';
import { defaultParams } from './effects.js';

const PROP_LABELS = {
  anchor: 'アンカーポイント', position: '位置', scale: 'スケール',
  rotation: '回転', opacity: '不透明度',
};
export { PROP_LABELS };

function snapFrame(t, comp) {
  return Math.round(t * comp.fps) / comp.fps;
}

// ---- コンポジション ----
export function newComposition(opts) {
  snapshot();
  const comp = makeComp(opts);
  state.project.comps[comp.id] = comp;
  state.project.items.push({ id: comp.id, mainType: 'composition', name: comp.name });
  state.currentCompId = comp.id;
  state.currentTime = 0;
  state.selectedLayerIds = [];
  state.view.zoom = 'fit'; state.view.panX = 0; state.view.panY = 0;
  emit('project'); emit('layers'); emit('time'); emit('selection'); emit('view');
  return comp;
}
export function updateCompSettings(compId, opts) {
  snapshot();
  const comp = state.project.comps[compId];
  if (!comp) return;
  Object.assign(comp, opts);
  const item = getItem(compId);
  if (item) item.name = comp.name;
  if (comp.workArea.end > comp.duration) comp.workArea.end = comp.duration;
  emit('project'); emit('layers'); emit('time');
}
export function openComposition(id) {
  if (!state.project.comps[id]) return;
  state.currentCompId = id;
  state.currentTime = 0;
  state.selectedLayerIds = [];
  state.selectedKeyframes = [];
  state.view.zoom = 'fit'; state.view.panX = 0; state.view.panY = 0;
  emit('layers'); emit('time'); emit('selection'); emit('view'); emit('project');
}
export function deleteComp(compId) {
  const comp = state.project.comps[compId];
  if (!comp) return;
  snapshot();
  delete state.project.comps[compId];
  state.project.items = state.project.items.filter(i => i.id !== compId);
  if (state.currentCompId === compId) {
    const rest = Object.keys(state.project.comps);
    state.currentCompId = rest[0] || null;
    state.currentTime = 0;
    state.selectedLayerIds = [];
  }
  emit('project'); emit('layers'); emit('time'); emit('selection');
}
export function deleteProjectItem(itemId) {
  const item = getItem(itemId);
  if (!item) return;
  if (item.mainType === 'composition') return deleteComp(itemId);
  snapshot();
  state.project.items = state.project.items.filter(i => i.id !== itemId);
  for (const comp of Object.values(state.project.comps)) {
    comp.layers = comp.layers.filter(l => l.sourceId !== itemId);
  }
  if (state.selectedItemId === itemId) state.selectedItemId = null;
  emit('project'); emit('layers'); emit('selection');
}

// ---- フッテージ読み込み ----
export function importFootageFiles(files) {
  const list = [...files].filter(f => /^(image|video)\//.test(f.type));
  if (!list.length) return;
  snapshot();
  let pending = list.length;
  for (const file of list) {
    const reader = new FileReader();
    reader.onload = () => {
      const isVideo = file.type.startsWith('video/');
      const item = {
        id: uid(), mainType: 'footage', name: file.name,
        kind: isVideo ? 'video' : 'image', src: reader.result,
        width: 0, height: 0, duration: isVideo ? 0 : undefined,
      };
      state.project.items.push(item);
      emit('project');
      if (--pending === 0) emit('project');
    };
    reader.readAsDataURL(file);
  }
}
// フッテージアイテムをコンポにレイヤーとして追加
export function addFootageLayer(itemId) {
  const comp = getComp();
  const item = getItem(itemId);
  if (!comp || !item) return;
  snapshot();
  const w = item.width || comp.width, h = item.height || comp.height;
  const dur = item.kind === 'video' && item.duration ? item.duration : comp.duration;
  const layer = makeLayer({
    name: item.name.replace(/\.[^.]+$/, ''), type: 'footage', sourceId: itemId,
    inTime: 0, outTime: Math.min(dur, comp.duration),
  });
  layer.transform.anchor = { x: w / 2, y: h / 2 };
  layer.transform.position = { x: comp.width / 2, y: comp.height / 2 };
  comp.layers.unshift(layer);
  selectLayers([layer.id]);
  emit('layers');
}

// ---- レイヤー作成 ----
export function newSolidLayer({ name, width, height, color }) {
  const comp = getComp();
  if (!comp) return;
  snapshot();
  const item = {
    id: uid(), mainType: 'solid', name: name || 'ソリッド',
    color: color || '#808080', width: width || comp.width, height: height || comp.height,
  };
  state.project.items.push(item);
  const layer = makeLayer({
    name: item.name, type: 'solid', sourceId: item.id,
    inTime: 0, outTime: comp.duration,
  });
  layer.transform.anchor = { x: item.width / 2, y: item.height / 2 };
  layer.transform.position = { x: comp.width / 2, y: comp.height / 2 };
  comp.layers.unshift(layer);
  selectLayers([layer.id]);
  emit('project'); emit('layers');
}
export function newTextLayer(opts = {}) {
  const comp = getComp();
  if (!comp) return;
  snapshot();
  const text = {
    content: opts.content || 'テキスト',
    fontFamily: opts.fontFamily || "'Segoe UI', 'Meiryo', sans-serif",
    fontSize: opts.fontSize || Math.round(comp.height / 12),
    fillColor: opts.fillColor || '#ffffff',
  };
  const layer = makeLayer({
    name: text.content, type: 'text', text,
    inTime: 0, outTime: comp.duration,
  });
  const m = measureText(text);
  layer.transform.anchor = { x: m.w / 2, y: m.h / 2 };
  layer.transform.position = opts.position
    ? { x: opts.position.x, y: opts.position.y }
    : { x: comp.width / 2, y: comp.height / 2 };
  comp.layers.unshift(layer);
  selectLayers([layer.id]);
  emit('layers');
  return layer;
}
export function newShapeLayer(kind, rect, fillColor) {
  const comp = getComp();
  if (!comp) return;
  snapshot();
  const w = Math.max(1, Math.abs(rect.w)), h = Math.max(1, Math.abs(rect.h));
  const layer = makeLayer({
    name: kind === 'ellipse' ? '楕円 1' : '長方形 1', type: 'shape',
    shape: { kind, width: Math.round(w), height: Math.round(h), fillColor: fillColor || '#4a7fd4', strokeColor: '', strokeWidth: 0 },
    inTime: 0, outTime: comp.duration,
  });
  layer.transform.anchor = { x: w / 2, y: h / 2 };
  layer.transform.position = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  comp.layers.unshift(layer);
  selectLayers([layer.id]);
  emit('layers');
  return layer;
}

// ---- レイヤー操作 ----
export function deleteSelectedLayers() {
  const comp = getComp();
  if (!comp || !state.selectedLayerIds.length) return;
  snapshot();
  comp.layers = comp.layers.filter(l => !state.selectedLayerIds.includes(l.id));
  state.selectedLayerIds = [];
  state.selectedKeyframes = [];
  emit('layers'); emit('selection');
}
export function duplicateSelected() {
  const comp = getComp();
  const layers = selectedLayers();
  if (!comp || !layers.length) return;
  snapshot();
  const newIds = [];
  for (const layer of layers) {
    const idx = comp.layers.indexOf(layer);
    const copy = cloneDeep(layer);
    copy.id = uid();
    copy.name = layer.name;
    comp.layers.splice(idx, 0, copy); // 元の1つ上に挿入
    newIds.push(copy.id);
  }
  selectLayers(newIds);
  emit('layers');
}
export function splitSelectedAt(time) {
  const comp = getComp();
  const layers = selectedLayers();
  if (!comp || !layers.length) return;
  snapshot();
  const newIds = [];
  for (const layer of layers) {
    const t = snapFrame(time, comp);
    if (t <= layer.inTime || t >= layer.outTime) continue;
    const idx = comp.layers.indexOf(layer);
    const tail = cloneDeep(layer);
    tail.id = uid();
    tail.inTime = t;
    layer.outTime = t;
    comp.layers.splice(idx, 0, tail); // 後半が上に来る (AE と同様)
    newIds.push(tail.id);
  }
  if (newIds.length) selectLayers(newIds);
  emit('layers');
}
export function renameLayer(layerId, name) {
  const layer = getLayer(layerId);
  if (!layer || !name) return;
  snapshot();
  layer.name = name;
  emit('layers');
}
export function setLayerFlag(layerId, flag, value) {
  const layer = getLayer(layerId);
  if (!layer) return;
  snapshot();
  layer[flag] = value;
  emit('layers');
}
export function setBlendMode(layerId, mode) {
  const layer = getLayer(layerId);
  if (!layer) return;
  snapshot();
  layer.blendMode = mode;
  emit('layers'); emit('values');
}
export function setLayerLabel(layerId, color) {
  const layer = getLayer(layerId);
  if (!layer) return;
  snapshot();
  layer.label = color;
  emit('layers');
}
// 重ね順: 'up' | 'down' | 'top' | 'bottom'
export function reorderLayer(layerId, dir) {
  const comp = getComp();
  if (!comp) return;
  const idx = comp.layers.findIndex(l => l.id === layerId);
  if (idx < 0) return;
  snapshot();
  const [layer] = comp.layers.splice(idx, 1);
  if (dir === 'up') comp.layers.splice(Math.max(0, idx - 1), 0, layer);
  else if (dir === 'down') comp.layers.splice(Math.min(comp.layers.length, idx + 1), 0, layer);
  else if (dir === 'top') comp.layers.unshift(layer);
  else comp.layers.push(layer);
  emit('layers');
}
export function resetTransform(layerId) {
  const layer = getLayer(layerId);
  const comp = getComp();
  if (!layer || !comp) return;
  snapshot();
  const { w, h } = contentSize(layer, comp);
  layer.transform = {
    anchor: { x: w / 2, y: h / 2 },
    position: { x: comp.width / 2, y: comp.height / 2 },
    scale: { x: 100, y: 100 },
    rotation: 0, opacity: 100,
  };
  layer.kf = { anchor: [], position: [], scale: [], rotation: [], opacity: [] };
  emit('layers'); emit('values');
}
export function trimLayerEdge(layerId, edge, time) {
  const comp = getComp();
  const layer = getLayer(layerId);
  if (!layer || !comp) return;
  snapshot();
  const t = snapFrame(clamp(time, 0, comp.duration), comp);
  if (edge === 'in' && t < layer.outTime) {
    const d = t - layer.inTime;
    layer.inTime = t;
    if (layer.type === 'footage') layer.offset = Math.max(0, (layer.offset || 0) + d);
  } else if (edge === 'out' && t > layer.inTime) {
    layer.outTime = t;
  }
  emit('layers');
}
export function moveLayerBar(layerId, newInTime) {
  const comp = getComp();
  const layer = getLayer(layerId);
  if (!layer || !comp) return;
  const dur = layer.outTime - layer.inTime;
  layer.inTime = clamp(newInTime, -dur + 0.001, comp.duration);
  layer.outTime = layer.inTime + dur;
  emit('layers');
}
export function trimLayerBar(layerId, which, t) {
  const comp = getComp();
  const layer = getLayer(layerId);
  if (!layer || !comp) return;
  if (which === 'in') {
    const nt = clamp(t, -60, layer.outTime - 1 / comp.fps);
    const d = nt - layer.inTime;
    if (layer.type === 'footage') {
      const item = getItem(layer.sourceId);
      const maxD = (layer.offset || 0); // ソース先頭より前には出せない
      const dd = Math.max(d, -maxD);
      layer.inTime += dd;
      layer.offset = (layer.offset || 0) + dd;
      if (item?.duration && layer.outTime - layer.inTime > item.duration - layer.offset) {
        layer.inTime = layer.outTime - (item.duration - layer.offset);
      }
    } else {
      layer.inTime = nt;
    }
  } else {
    let nt = Math.max(t, layer.inTime + 1 / comp.fps);
    if (layer.type === 'footage') {
      const item = getItem(layer.sourceId);
      if (item?.duration) nt = Math.min(nt, layer.inTime + (item.duration - (layer.offset || 0)));
    }
    layer.outTime = nt;
  }
  emit('layers');
}

// ---- プロパティ / キーフレーム ----
// snap: true で Undo スナップショット取得 (ドラッグ開始時など)
export function setProp(layer, prop, value, { snap = false } = {}) {
  if (!layer) return;
  if (snap) snapshot();
  const kfs = layer.kf[prop];
  if (kfs && kfs.length) {
    if (upsertKeyframe(layer, prop, state.currentTime, cloneDeep(value))) emit('layers');
  } else {
    layer.transform[prop] = cloneDeep(value);
  }
  emit('values');
}
// 戻り値: 新規キーフレームが挿入されたら true
function upsertKeyframe(layer, prop, time, value) {
  const comp = getComp();
  const t = comp ? snapFrame(time, comp) : time;
  const kfs = layer.kf[prop];
  const tol = 0.5 / (comp?.fps || 30);
  const found = kfs.find(k => Math.abs(k.time - t) < tol);
  if (found) { found.value = value; return false; }
  kfs.push({ time: t, value, ease: 'linear' });
  kfs.sort((a, b) => a.time - b.time);
  return true;
}
export function toggleStopwatch(layer, prop) {
  snapshot();
  const kfs = layer.kf[prop];
  if (kfs.length === 0) {
    kfs.push({ time: state.currentTime, value: cloneDeep(layer.transform[prop]), ease: 'linear' });
  } else {
    kfs.length = 0;
  }
  emit('layers'); emit('values');
}
export function keyframeAt(layer, prop, time) {
  const comp = getComp();
  const tol = 0.5 / (comp?.fps || 30);
  return layer.kf[prop].findIndex(k => Math.abs(k.time - time) < tol);
}
export function toggleKeyframeAtCurrent(layer, prop) {
  const idx = keyframeAt(layer, prop, state.currentTime);
  snapshot();
  if (idx >= 0) layer.kf[prop].splice(idx, 1);
  else upsertKeyframe(layer, prop, state.currentTime, cloneDeep(currentPropValue(layer, prop)));
  emit('layers'); emit('values');
}
export function currentPropValue(layer, prop) {
  const kfs = layer.kf[prop];
  if (!kfs.length) return layer.transform[prop];
  // 評価値 (render.evalProp と同等だが循環参照回避のため簡易実装)
  const t = state.currentTime;
  if (t <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (t >= last.time) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t >= a.time && t <= b.time) {
      let u = (t - a.time) / (b.time - a.time);
      if (b.ease === 'ease') u = u * u * (3 - 2 * u);
      if (typeof a.value === 'number') return a.value + (b.value - a.value) * u;
      return { x: a.value.x + (b.value.x - a.value.x) * u, y: a.value.y + (b.value.y - a.value.y) * u };
    }
  }
  return last.value;
}
export function gotoKeyframe(layer, prop, dir) {
  const kfs = layer.kf[prop];
  if (!kfs.length) return;
  const t = state.currentTime;
  const comp = getComp();
  const tol = 0.5 / (comp?.fps || 30);
  let target = null;
  if (dir < 0) {
    for (let i = kfs.length - 1; i >= 0; i--) if (kfs[i].time < t - tol) { target = kfs[i].time; break; }
  } else {
    for (let i = 0; i < kfs.length; i++) if (kfs[i].time > t + tol) { target = kfs[i].time; break; }
  }
  if (target != null) setTime(target);
}
export function moveKeyframe(layerId, prop, index, newTime) {
  const comp = getComp();
  const layer = getLayer(layerId);
  if (!layer || !comp) return;
  const kfs = layer.kf[prop];
  if (!kfs[index]) return;
  kfs[index].time = snapFrame(clamp(newTime, 0, comp.duration), comp);
  kfs.sort((a, b) => a.time - b.time);
  emit('layers'); emit('values');
}
export function deleteSelectedKeyframes() {
  if (!state.selectedKeyframes.length) return;
  snapshot();
  // layerId+prop ごとにグルーピングして降順削除 (インデックスずれ防止)
  const groups = {};
  for (const s of state.selectedKeyframes) {
    const key = s.layerId + '|' + s.prop;
    (groups[key] ??= []).push(s.index);
  }
  for (const [key, indices] of Object.entries(groups)) {
    const [layerId, prop] = key.split('|');
    const layer = getLayer(layerId);
    if (!layer) continue;
    indices.sort((a, b) => b - a).forEach(i => layer.kf[prop].splice(i, 1));
  }
  state.selectedKeyframes = [];
  emit('layers'); emit('values'); emit('selection');
}
export function easeSelectedKeyframes(mode) {
  if (!state.selectedKeyframes.length) return;
  snapshot();
  for (const { layerId, prop, index } of state.selectedKeyframes) {
    const layer = getLayer(layerId);
    if (layer?.kf[prop]?.[index]) layer.kf[prop][index].ease = mode;
  }
  emit('layers'); emit('values');
}
export function selectKeyframe(layerId, prop, index, { additive = false } = {}) {
  const entry = { layerId, prop, index };
  if (additive) {
    const i = state.selectedKeyframes.findIndex(s => s.layerId === layerId && s.prop === prop && s.index === index);
    if (i >= 0) state.selectedKeyframes.splice(i, 1);
    else state.selectedKeyframes.push(entry);
  } else {
    state.selectedKeyframes = [entry];
  }
  emit('selection');
}

// ---- エフェクト ----
export function applyEffectToSelected(effectId) {
  const layers = selectedLayers();
  if (!layers.length) return false;
  snapshot();
  for (const layer of layers) {
    layer.effects.push({ id: uid(), effectId, enabled: true, params: defaultParams(effectId) });
  }
  emit('layers'); emit('values'); emit('selection');
  return true;
}
export function removeEffect(layerId, fxId) {
  const layer = getLayer(layerId);
  if (!layer) return;
  snapshot();
  layer.effects = layer.effects.filter(f => f.id !== fxId);
  emit('layers'); emit('values'); emit('selection');
}
export function setEffectParam(layerId, fxId, key, value) {
  const layer = getLayer(layerId);
  const fx = layer?.effects.find(f => f.id === fxId);
  if (!fx) return;
  fx.params[key] = value;
  emit('values');
}
export function toggleEffect(layerId, fxId) {
  const layer = getLayer(layerId);
  const fx = layer?.effects.find(f => f.id === fxId);
  if (!fx) return;
  snapshot();
  fx.enabled = !fx.enabled;
  emit('layers'); emit('values'); emit('selection');
}
export function resetEffect(layerId, fxId) {
  const layer = getLayer(layerId);
  const fx = layer?.effects.find(f => f.id === fxId);
  if (!fx) return;
  snapshot();
  fx.params = defaultParams(fx.effectId);
  emit('layers'); emit('values'); emit('selection');
}
export function moveEffect(layerId, fxId, dir) {
  const layer = getLayer(layerId);
  if (!layer) return;
  const i = layer.effects.findIndex(f => f.id === fxId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layer.effects.length) return;
  snapshot();
  [layer.effects[i], layer.effects[j]] = [layer.effects[j], layer.effects[i]];
  emit('layers'); emit('values'); emit('selection');
}

// ---- テキスト / ソリッド設定 ----
export function updateTextLayer(layerId, props) {
  const layer = getLayer(layerId);
  if (!layer || layer.type !== 'text') return;
  snapshot();
  const oldCenter = contentSize(layer, getComp());
  Object.assign(layer.text, props);
  layer.name = layer.text.content || layer.name;
  const m = measureText(layer.text);
  // アンカーを中央に保つ (サイズ変更分を位置で補正しないシンプル仕様)
  layer.transform.anchor = { x: m.w / 2, y: m.h / 2 };
  emit('layers'); emit('values');
}
export function updateSolidItem(itemId, { name, width, height, color }) {
  const item = getItem(itemId);
  if (!item || item.mainType !== 'solid') return;
  snapshot();
  if (name) item.name = name;
  if (width) item.width = width;
  if (height) item.height = height;
  if (color) item.color = color;
  for (const comp of Object.values(state.project.comps)) {
    for (const layer of comp.layers) {
      if (layer.sourceId === itemId && layer.type === 'solid') {
        layer.name = item.name;
        layer.transform.anchor = { x: item.width / 2, y: item.height / 2 };
      }
    }
  }
  emit('project'); emit('layers'); emit('values');
}
export function setWorkArea(which, time) {
  const comp = getComp();
  if (!comp) return;
  const t = clamp(time, 0, comp.duration);
  if (which === 'start') comp.workArea.start = Math.min(t, comp.workArea.end - 1 / comp.fps);
  else comp.workArea.end = Math.max(t, comp.workArea.start + 1 / comp.fps);
  emit('layers'); emit('time');
}
