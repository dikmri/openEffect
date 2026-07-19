// アプリケーション状態 / プロジェクトデータモデル / Undo-Redo / 永続化
import { uid, cloneDeep } from './utils.js';
import { measureText } from './render.js';

export const state = {
  project: null,
  currentCompId: null,
  selectedItemId: null,      // プロジェクトパネル選択
  selectedLayerIds: [],
  selectedKeyframes: [],     // [{layerId, prop, index}]
  currentTime: 0,
  playing: false,
  tool: 'selection',         // selection|hand|zoom|rotate|text|rect|ellipse
  view: { zoom: 'fit', panX: 0, panY: 0, res: 1 },
  shapeFill: '#4a7fd4',
  uiLock: false,             // ドラッグ中: タイムライン全再描画を抑止
  panels: { project: true, effectControls: true, info: true, preview: true, effects: true, timeline: true },
};

// ---- イベントバス ----
const listeners = {};
export const bus = {
  on(type, fn) { (listeners[type] ??= []).push(fn); },
  emit(type, data) { (listeners[type] || []).forEach(fn => fn(data)); },
};
export function emit(type) { bus.emit(type); }
export function emitAll() {
  ['project', 'layers', 'values', 'time', 'selection', 'view', 'tool'].forEach(t => bus.emit(t));
}

// ---- アクセサ ----
export function getComp() {
  return state.project?.comps[state.currentCompId] || null;
}
export function getCompById(id) {
  return state.project?.comps[id] || null;
}
export function getItem(id) {
  return state.project?.items.find(i => i.id === id) || null;
}
export function getLayer(id) {
  const comp = getComp();
  return comp?.layers.find(l => l.id === id) || null;
}
export function selectedLayers() {
  const comp = getComp();
  if (!comp) return [];
  return comp.layers.filter(l => state.selectedLayerIds.includes(l.id));
}
export function setTime(t) {
  const comp = getComp();
  if (comp) state.currentTime = Math.max(0, Math.min(comp.duration, t));
  else state.currentTime = Math.max(0, t);
  emit('time');
  emit('values');
}
export function selectLayers(ids, { additive = false, toggle = false } = {}) {
  if (additive) {
    const set = new Set(state.selectedLayerIds);
    ids.forEach(id => set.add(id));
    state.selectedLayerIds = [...set];
  } else if (toggle) {
    const set = new Set(state.selectedLayerIds);
    ids.forEach(id => set.has(id) ? set.delete(id) : set.add(id));
    state.selectedLayerIds = [...set];
  } else {
    state.selectedLayerIds = [...ids];
  }
  state.selectedKeyframes = [];
  emit('selection');
}

// ---- Undo / Redo ----
const undoStack = [];
let redoStack = [];
const UNDO_LIMIT = 40;

function serialize() {
  return JSON.stringify({
    project: state.project,
    currentCompId: state.currentCompId,
    selectedLayerIds: state.selectedLayerIds,
  }, (k, v) => k.startsWith('_') ? undefined : v);
}
function restore(json) {
  const data = JSON.parse(json);
  state.project = data.project;
  state.currentCompId = data.currentCompId;
  state.selectedLayerIds = data.selectedLayerIds || [];
  state.selectedKeyframes = [];
  emitAll();
}
export function snapshot() {
  try {
    undoStack.push(serialize());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  } catch (e) { /* 巨大フッテージ等でシリアライズ失敗時は無視 */ }
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(serialize());
  restore(undoStack.pop());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(serialize());
  restore(redoStack.pop());
}
export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

// ---- 永続化 (localStorage) ----
const LS_KEY = 'openEffect.project.v1';
export function saveLocal() {
  try {
    localStorage.setItem(LS_KEY, serialize());
    return true;
  } catch (e) {
    console.warn('保存に失敗しました', e);
    return false;
  }
}
export function loadLocal() {
  try {
    const json = localStorage.getItem(LS_KEY);
    if (!json) return false;
    restore(json);
    return true;
  } catch (e) { return false; }
}
export function exportProjectJSON() { return serialize(); }
export function importProjectJSON(json) {
  snapshot();
  restore(json);
}

// ---- レイヤー / コンポのファクトリ ----
export function makeTransform() {
  return {
    anchor: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    scale: { x: 100, y: 100 },
    rotation: 0,
    opacity: 100,
  };
}
export function makeKfStore() {
  return { anchor: [], position: [], scale: [], rotation: [], opacity: [] };
}

const LABEL_COLORS = {
  footage: '#c9a86a', solid: '#8f8f9e', text: '#5b8dd9', shape: '#4aa3a3',
};
export function defaultLabel(type) { return LABEL_COLORS[type] || '#c9a86a'; }

export function makeLayer(partial) {
  const layer = {
    id: uid(),
    name: 'レイヤー',
    type: 'solid',
    sourceId: null,
    enabled: true, solo: false, locked: false, shy: false,
    blendMode: 'normal',
    label: null,
    inTime: 0, outTime: 10, offset: 0,
    transform: makeTransform(),
    kf: makeKfStore(),
    effects: [],
    text: null, shape: null,
  };
  Object.assign(layer, partial);
  if (!layer.label) layer.label = defaultLabel(layer.type);
  return layer;
}

export function makeComp(opts) {
  return {
    id: uid(),
    name: opts.name || 'コンポジション 1',
    width: opts.width || 1920,
    height: opts.height || 1080,
    fps: opts.fps || 29.97,
    duration: opts.duration != null ? opts.duration : 10,
    bgColor: opts.bgColor || '#000000',
    workArea: { start: 0, end: opts.duration != null ? opts.duration : 10 },
    layers: [],
  };
}

// ---- デフォルトプロジェクト (デモ入り) ----
export function createDefaultProject() {
  const comp = makeComp({ name: 'コンポジション 1', width: 1920, height: 1080, fps: 29.97, duration: 10, bgColor: '#101014' });

  // 背景ソリッド
  const bgItem = { id: uid(), mainType: 'solid', name: '背景', color: '#1d2130', width: 1920, height: 1080 };
  const bg = makeLayer({
    name: '背景', type: 'solid', sourceId: bgItem.id,
    inTime: 0, outTime: 10,
  });
  bg.transform.anchor = { x: 960, y: 540 };
  bg.transform.position = { x: 960, y: 540 };

  // 回転するシェイプ
  const shape = makeLayer({
    name: 'シェイプ 1', type: 'shape',
    shape: { kind: 'rect', width: 360, height: 360, fillColor: '#4a7fd4', strokeColor: '#ffffff', strokeWidth: 4 },
    inTime: 0, outTime: 10,
  });
  shape.transform.anchor = { x: 180, y: 180 };
  shape.transform.position = { x: 640, y: 540 };
  shape.kf.rotation = [
    { time: 0, value: 0, ease: 'linear' },
    { time: 4, value: 360, ease: 'linear' },
  ];

  // グロー付き楕円
  const circle = makeLayer({
    name: 'シェイプ 2', type: 'shape',
    shape: { kind: 'ellipse', width: 300, height: 300, fillColor: '#e06a5a', strokeColor: '', strokeWidth: 0 },
    inTime: 0, outTime: 10,
  });
  circle.transform.anchor = { x: 150, y: 150 };
  circle.transform.position = { x: 1280, y: 540 };
  circle.kf.scale = [
    { time: 0, value: { x: 80, y: 80 }, ease: 'ease' },
    { time: 2, value: { x: 120, y: 120 }, ease: 'ease' },
    { time: 4, value: { x: 80, y: 80 }, ease: 'ease' },
  ];
  circle.effects.push({ id: uid(), effectId: 'glow', enabled: true, params: { intensity: 1.2, radius: 40 } });

  // タイトルテキスト
  const text = makeLayer({
    name: 'openEffect', type: 'text',
    text: { content: 'openEffect', fontFamily: "'Segoe UI', 'Meiryo', sans-serif", fontSize: 140, fillColor: '#ffffff' },
    inTime: 0, outTime: 10,
  });
  const tm = measureText(text.text);
  text.transform.anchor = { x: tm.w / 2, y: tm.h / 2 };
  text.transform.position = { x: 960, y: 540 };
  text.kf.position = [
    { time: 0, value: { x: -600, y: 540 }, ease: 'ease' },
    { time: 1, value: { x: 960, y: 540 }, ease: 'ease' },
  ];
  text.kf.opacity = [
    { time: 0, value: 0, ease: 'ease' },
    { time: 1, value: 100, ease: 'ease' },
  ];

  comp.layers = [text, circle, shape, bg]; // 先頭が最前面

  state.project = {
    name: '名称未設定プロジェクト',
    items: [
      { id: comp.id, mainType: 'composition', name: comp.name },
      bgItem,
    ],
    comps: { [comp.id]: comp },
  };
  state.currentCompId = comp.id;
  state.currentTime = 0;
  state.selectedLayerIds = [];
  state.selectedItemId = null;
  undoStack.length = 0;
  redoStack = [];
}
