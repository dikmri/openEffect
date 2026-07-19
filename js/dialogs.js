// AE 風モーダルダイアログ群
import { el, timecodeToSeconds, durationToTimecode } from './utils.js';
import { state, getComp } from './state.js';
import * as actions from './actions.js';

// ---- 基本モーダル ----
export function openModal(title, bodyBuilder, { onOk, okLabel = 'OK', width = 380 } = {}) {
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (onOk && onOk() === false) return; close(); }
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const btnOk = el('button', { class: 'dlg-btn primary', text: okLabel, on: { click: () => { if (onOk && onOk() === false) return; close(); } } });
  const btnCancel = el('button', { class: 'dlg-btn', text: 'キャンセル', on: { click: close } });
  const body = el('div', { class: 'dlg-body' });
  bodyBuilder(body);
  const dlg = el('div', { class: 'dlg', style: { width: width + 'px' } },
    el('div', { class: 'dlg-title' }, el('span', { text: title })),
    body,
    el('div', { class: 'dlg-footer' }, btnOk, btnCancel),
  );
  const overlay = el('div', { class: 'dlg-overlay', on: { mousedown: e => { if (e.target === overlay) close(); } } }, dlg);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  const first = dlg.querySelector('input, select, textarea');
  if (first) { first.focus(); first.select?.(); }
  return close;
}

function row(label, ...controls) {
  return el('div', { class: 'dlg-row' }, el('label', { class: 'dlg-label', text: label }), el('div', { class: 'dlg-ctrl' }, ...controls));
}
function numInput(value, { min, max, step = 1, width = 70 } = {}) {
  const i = el('input', { type: 'number', value, step, style: { width: width + 'px' } });
  if (min != null) i.min = min;
  if (max != null) i.max = max;
  return i;
}

const COMP_PRESETS = [
  ['custom', 'カスタム', null],
  ['hdtv1080_2997', 'HDTV 1080 29.97', { width: 1920, height: 1080, fps: 29.97 }],
  ['hdtv1080_25', 'HDTV 1080 25', { width: 1920, height: 1080, fps: 25 }],
  ['hd720_2997', 'HDV/HDTV 720 29.97', { width: 1280, height: 720, fps: 29.97 }],
  ['ntsc', 'NTSC DV', { width: 720, height: 480, fps: 29.97 }],
  ['web1920', 'Web 1920x1080 30', { width: 1920, height: 1080, fps: 30 }],
  ['square1080', '正方形 1080x1080 30', { width: 1080, height: 1080, fps: 30 }],
  ['vertical1080', '縦型 1080x1920 30', { width: 1080, height: 1920, fps: 30 }],
];
const FPS_LIST = [60, 59.94, 50, 30, 29.97, 25, 24, 23.976, 15];

// ---- コンポジション設定ダイアログ (新規/編集共通) ----
function compSettingsBody(body, init) {
  const name = el('input', { type: 'text', value: init.name, style: { width: '220px' } });
  const preset = el('select', {}, COMP_PRESETS.map(([v, l]) => el('option', { value: v, text: l })));
  const w = numInput(init.width, { min: 4, max: 8192 });
  const h = numInput(init.height, { min: 4, max: 8192 });
  const par = el('select', {}, el('option', { text: '正方形ピクセル' }));
  const fps = el('select', {}, FPS_LIST.map(f => el('option', { value: f, text: String(f), selected: f === init.fps })));
  if (!FPS_LIST.includes(init.fps)) fps.prepend(el('option', { value: init.fps, text: String(init.fps), selected: true }));
  const dur = el('input', { type: 'text', value: durationToTimecode(init.duration, init.fps), style: { width: '90px' } });
  const bg = el('input', { type: 'color', value: init.bgColor });
  preset.addEventListener('change', () => {
    const p = COMP_PRESETS.find(([v]) => v === preset.value)?.[2];
    if (p) { w.value = p.width; h.value = p.height; fps.value = String(p.fps); }
  });
  body.append(
    row('コンポジション名', name),
    row('プリセット', preset),
    el('div', { class: 'dlg-group', text: '基本' }),
    row('幅', w, el('span', { class: 'dlg-unit', text: 'px' })),
    row('高さ', h, el('span', { class: 'dlg-unit', text: 'px' })),
    row('ピクセル縦横比', par),
    row('フレームレート', fps, el('span', { class: 'dlg-unit', text: 'フレーム/秒' })),
    row('デュレーション', dur),
    row('背景色', bg),
  );
  return () => {
    const fpsVal = parseFloat(fps.value) || 29.97;
    const durSec = timecodeToSeconds(dur.value, fpsVal);
    if (!durSec || durSec <= 0) { alert('デュレーションが不正です。'); return false; }
    return {
      name: name.value.trim() || '名称未設定コンポジション',
      width: Math.max(4, parseInt(w.value) || 1920),
      height: Math.max(4, parseInt(h.value) || 1080),
      fps: fpsVal,
      duration: durSec,
      bgColor: bg.value,
    };
  };
}

export function newCompDialog() {
  let collect;
  openModal('新規コンポジション', body => {
    collect = compSettingsBody(body, {
      name: nextCompName(), width: 1920, height: 1080, fps: 29.97, duration: 10, bgColor: '#000000',
    });
  }, {
    onOk: () => { const opts = collect(); if (opts === false) return false; actions.newComposition(opts); },
    okLabel: 'OK', width: 400,
  });
}
function nextCompName() {
  const names = Object.values(state.project.comps).map(c => c.name);
  let n = names.length + 1;
  while (names.includes('コンポジション ' + n)) n++;
  return 'コンポジション ' + n;
}
export function compSettingsDialog() {
  const comp = getComp();
  if (!comp) return;
  let collect;
  openModal('コンポジション設定', body => { collect = compSettingsBody(body, comp); }, {
    onOk: () => { const opts = collect(); if (opts === false) return false; actions.updateCompSettings(comp.id, opts); },
    width: 400,
  });
}

// ---- 新規ソリッド ----
export function newSolidDialog() {
  const comp = getComp();
  if (!comp) return;
  let collect;
  openModal('新規ソリッド', body => {
    const name = el('input', { type: 'text', value: 'ソリッド ' + (state.project.items.filter(i => i.mainType === 'solid').length + 1), style: { width: '200px' } });
    const w = numInput(comp.width, { min: 4, max: 8192 });
    const h = numInput(comp.height, { min: 4, max: 8192 });
    const color = el('input', { type: 'color', value: '#808080' });
    const fitBtn = el('button', { class: 'dlg-btn small', text: 'コンポジションサイズに合わせる', on: { click: () => { w.value = comp.width; h.value = comp.height; } } });
    body.append(
      row('名前', name),
      row('サイズ', w, el('span', { class: 'dlg-unit', text: '×' }), h, el('span', { class: 'dlg-unit', text: 'px' })),
      row('', fitBtn),
      row('カラー', color),
    );
    collect = () => ({
      name: name.value.trim() || 'ソリッド',
      width: Math.max(4, parseInt(w.value) || comp.width),
      height: Math.max(4, parseInt(h.value) || comp.height),
      color: color.value,
    });
  }, {
    onOk: () => { actions.newSolidLayer(collect()); },
  });
}

// ---- ソリッド設定 ----
export function solidSettingsDialog(layer) {
  const item = state.project.items.find(i => i.id === layer.sourceId);
  if (!item) return;
  let collect;
  openModal('ソリッド設定', body => {
    const name = el('input', { type: 'text', value: item.name, style: { width: '200px' } });
    const w = numInput(item.width, { min: 4, max: 8192 });
    const h = numInput(item.height, { min: 4, max: 8192 });
    const color = el('input', { type: 'color', value: item.color });
    body.append(
      row('名前', name),
      row('サイズ', w, el('span', { class: 'dlg-unit', text: '×' }), h, el('span', { class: 'dlg-unit', text: 'px' })),
      row('カラー', color),
    );
    collect = () => ({
      name: name.value.trim() || item.name,
      width: Math.max(4, parseInt(w.value) || item.width),
      height: Math.max(4, parseInt(h.value) || item.height),
      color: color.value,
    });
  }, {
    onOk: () => actions.updateSolidItem(item.id, collect()),
  });
}

// ---- テキスト設定 ----
const FONTS = [
  ["'Segoe UI', 'Meiryo', sans-serif", 'Segoe UI / メイリオ'],
  ["'Yu Gothic', '游ゴシック', sans-serif", '游ゴシック'],
  ["'Meiryo', 'メイリオ', sans-serif", 'メイリオ'],
  ["'MS Gothic', monospace", 'MS ゴシック'],
  ["'Hiragino Sans', sans-serif", 'ヒラギノ角ゴ'],
  ['Georgia, serif', 'Georgia (セリフ)'],
  ['monospace', '等幅'],
];
export function textSettingsDialog(layer) {
  let collect;
  openModal('テキスト設定', body => {
    const content = el('textarea', { rows: 2, style: { width: '240px' } });
    content.value = layer.text.content;
    const font = el('select', {}, FONTS.map(([v, l]) => el('option', { value: v, text: l, selected: v === layer.text.fontFamily })));
    const size = numInput(layer.text.fontSize, { min: 1, max: 2000 });
    const color = el('input', { type: 'color', value: layer.text.fillColor });
    body.append(
      row('内容', content),
      row('フォント', font),
      row('サイズ', size, el('span', { class: 'dlg-unit', text: 'px' })),
      row('カラー', color),
    );
    collect = () => ({
      content: content.value || 'テキスト',
      fontFamily: font.value,
      fontSize: Math.max(1, parseInt(size.value) || 48),
      fillColor: color.value,
    });
  }, {
    onOk: () => actions.updateTextLayer(layer.id, collect()),
  });
}

// ---- レイヤー設定 (種類で振り分け) ----
export function layerSettingsDialog(layer) {
  if (layer.type === 'text') textSettingsDialog(layer);
  else if (layer.type === 'solid') solidSettingsDialog(layer);
}

// ---- 確認ダイアログ ----
export function confirmDialog(message, onOk) {
  openModal('openEffect', body => {
    body.append(el('div', { class: 'dlg-message', text: message }));
  }, { onOk, okLabel: 'OK' });
}

// ---- バージョン情報 ----
export function aboutDialog() {
  openModal('openEffect について', body => {
    body.append(el('div', { class: 'dlg-message', html:
      '<b>openEffect</b> v1.0<br><br>Web 上で動く After Effects 風モーショングラフィックスツール。<br>ブラウザだけでコンポジション編集・キーフレームアニメーション・エフェクト適用ができます。'
    }));
  }, { okLabel: '閉じる' });
}

// ---- 書き出し (WebM) ----
export function exportWebMDialog() {
  const comp = getComp();
  if (!comp) return;
  let collect;
  openModal('WebM で書き出し', body => {
    const range = el('select', {},
      el('option', { value: 'work', text: 'ワークエリア' }),
      el('option', { value: 'full', text: 'コンポジション全体' }));
    body.append(
      el('div', { class: 'dlg-message', text: 'リアルタイム再生を録画して WebM を書き出します。書き出し中はタブを切り替えないでください。' }),
      row('範囲', range),
    );
    collect = () => range.value;
  }, {
    okLabel: '書き出し開始',
    onOk: () => {
      const mode = collect();
      window.dispatchEvent(new CustomEvent('openEffect:exportWebM', { detail: { range: mode } }));
    },
  });
}

// ---- ファイル選択ヘルパー ----
export function pickFiles(accept, multiple, onPick) {
  const input = el('input', { type: 'file', accept, style: { display: 'none' } });
  if (multiple) input.multiple = true;
  input.addEventListener('change', () => { onPick([...input.files]); input.remove(); });
  document.body.append(input);
  input.click();
}
