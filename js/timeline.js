// タイムラインパネル (AE の心臓部)
import { el, clamp, secondsToTimecode, timecodeToSeconds } from './utils.js';
import { state, bus, emit, getComp, selectLayers, setTime, snapshot } from './state.js';
import * as actions from './actions.js';
import { BLEND_MODES } from './render.js';
import * as dialogs from './dialogs.js';

const ICON = {
  eye: '<svg viewBox="0 0 16 16"><path d="M1.5 8 C4 3.5, 12 3.5, 14.5 8 C12 12.5, 4 12.5, 1.5 8 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  solo: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.6" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="4" y="7.2" width="8" height="5.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.6 7.2 V5 a2.4 2.4 0 0 1 4.8 0 V7.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  shy: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="10" cy="7" r="1" fill="currentColor"/><path d="M5.8 10.6 Q8 12.2 10.2 10.6" stroke="currentColor" fill="none" stroke-width="1"/></svg>',
  stopwatch: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.2" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="9" x2="8" y2="5.2" stroke="currentColor" stroke-width="1.3"/><line x1="6.5" y1="1.6" x2="9.5" y2="1.6" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="1.6" x2="8" y2="3.4" stroke="currentColor" stroke-width="1.3"/></svg>',
};
const PROPS = ['anchor', 'position', 'scale', 'rotation', 'opacity'];
const LABEL_COLORS = [
  ['#c94f4f', 'レッド'], ['#e0c341', 'イエロー'], ['#5b8dd9', 'ブルー'], ['#4aa37a', 'グリーン'],
  ['#9b59b6', 'パープル'], ['#e07b39', 'オレンジ'], ['#4fc3c9', 'アクア'], ['#e06a9e', 'ピンク'],
  ['#c9a86a', 'サンドストーン'], ['#8f8f9e', 'グレー'],
];

let pxPerSec = 60;
const expansions = new Map(); // layerId -> {layer:bool, transform:bool}
let shyMaster = false;
let layerCounter = 0;

export function initTimeline(container, titleEl) {
  // ---- ツールバー ----
  const timeDisplay = el('button', { class: 'tl-time', title: 'クリックして時間に移動' });
  timeDisplay.addEventListener('click', () => {
    const comp = getComp();
    if (!comp) return;
    const v = window.prompt('時間に移動 (時:分:秒:フレーム)', secondsToTimecode(state.currentTime, comp.fps));
    if (v == null) return;
    const t = timecodeToSeconds(v, comp.fps);
    if (t != null) setTime(t);
  });
  const shyBtn = el('button', { class: 'tl-tool-btn', title: 'シャイレイヤーを隠す', html: ICON.shy });
  shyBtn.addEventListener('click', () => { shyMaster = !shyMaster; shyBtn.classList.toggle('active', shyMaster); render(); });
  const graphBtn = el('button', { class: 'tl-tool-btn text', title: 'グラフエディター (未実装)', text: 'グラフエディター', disabled: true });
  const tabs = el('div', { class: 'tl-tabs' });
  const toolbar = el('div', { class: 'tl-toolbar' }, tabs, timeDisplay,
    el('div', { class: 'tl-toolbar-right' }, graphBtn, shyBtn));

  // ---- スクロール領域 ----
  const scroll = el('div', { class: 'tl-scroll' });
  const inner = el('div', { class: 'tl-inner' });
  scroll.append(inner);
  const playhead = el('div', { class: 'tl-playhead' });
  inner.append(playhead);

  // ---- 下部ズームバー ----
  const zoomSlider = el('input', { type: 'range', class: 'tl-zoom', min: 0, max: 100, value: 30 });
  zoomSlider.addEventListener('input', () => {
    pxPerSec = Math.exp(lerpNum(Math.log(4), Math.log(600), zoomSlider.value / 100));
    render();
  });
  const fitBtn = el('button', { class: 'tl-tool-btn text', text: 'フィット', title: '全体を表示' });
  fitBtn.addEventListener('click', () => fitZoom());
  const bottombar = el('div', { class: 'tl-bottombar' },
    el('span', { class: 'tl-zoom-ico', text: '▲', style: { fontSize: '7px' } }),
    zoomSlider,
    el('span', { class: 'tl-zoom-ico', text: '▲' }),
    fitBtn);

  container.append(el('div', { class: 'timeline-panel' }, toolbar, scroll, bottombar));

  function lerpNum(a, b, t) { return a + (b - a) * t; }
  function fitZoom() {
    const comp = getComp();
    if (!comp) return;
    const w = scroll.clientWidth - LEFT_W - 40;
    pxPerSec = clamp(w / comp.duration, 4, 600);
    zoomSlider.value = Math.round((Math.log(pxPerSec) - Math.log(4)) / (Math.log(600) - Math.log(4)) * 100);
    render();
  }

  const LEFT_W = 430;
  let graphW = 800;
  const t2x = t => t * pxPerSec;
  const x2t = x => x / pxPerSec;

  // ---- ルーラー ----
  function drawRuler(canvas, comp) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = graphW * dpr;
    canvas.height = 22 * dpr;
    canvas.style.width = graphW + 'px';
    canvas.style.height = '22px';
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#262626';
    c.fillRect(0, 0, graphW, 22);
    c.strokeStyle = '#555';
    c.fillStyle = '#999';
    c.font = '9px sans-serif';
    // ステップ選択
    const cands = [1 / comp.fps, 2 / comp.fps, 5 / comp.fps, 10 / comp.fps, 15 / comp.fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 300];
    const step = cands.find(s => s * pxPerSec >= 55) || 300;
    const minor = step / 5;
    c.beginPath();
    for (let t = 0; t <= comp.duration + 0.001; t += minor) {
      const x = Math.round(t2x(t)) + 0.5;
      c.moveTo(x, 16); c.lineTo(x, 22);
    }
    c.stroke();
    for (let t = 0; t <= comp.duration + 0.001; t += step) {
      const x = Math.round(t2x(t)) + 0.5;
      c.beginPath(); c.moveTo(x, 10); c.lineTo(x, 22); c.stroke();
      const label = step < 1
        ? secondsToTimecode(t, comp.fps).slice(3)
        : `${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, '0')}`;
      c.fillText(label, x + 3, 9);
    }
    // 再生ヘッド (ルーラー内)
    const px = t2x(state.currentTime);
    c.fillStyle = '#d33';
    c.beginPath();
    c.moveTo(px - 5, 0); c.lineTo(px + 5, 0); c.lineTo(px + 5, 6); c.lineTo(px, 12); c.lineTo(px - 5, 6);
    c.closePath(); c.fill();
    c.fillRect(px - 0.5, 0, 1, 22);
  }

  // ---- 左カラム共通 ----
  function leftCell(cls, ...children) {
    return el('div', { class: 'tl-cell ' + cls }, ...children);
  }

  // ---- レイヤー行 ----
  function buildLayerRow(layer, idx) {
    const exp = expansions.get(layer.id) || { layer: false, transform: false };
    const selected = state.selectedLayerIds.includes(layer.id);
    const row = el('div', {
      class: 'tl-row tl-layer-row' + (selected ? ' selected' : ''),
      dataset: { layerId: layer.id },
    });

    // 左側
    const twirl = el('button', { class: 'tl-twirl' + (exp.layer ? ' open' : ''), text: '▸' });
    twirl.addEventListener('click', e => {
      e.stopPropagation();
      exp.layer = !exp.layer;
      if (!exp.layer) exp.transform = false;
      expansions.set(layer.id, exp);
      render();
    });
    const chip = el('span', { class: 'tl-chip', style: { background: layer.label || '#888' } });
    const eye = swBtn(ICON.eye, layer.enabled, 'レイヤーの表示/非表示');
    eye.addEventListener('click', e => { e.stopPropagation(); actions.setLayerFlag(layer.id, 'enabled', !layer.enabled); });
    const solo = swBtn(ICON.solo, layer.solo, 'ソロ');
    solo.addEventListener('click', e => { e.stopPropagation(); actions.setLayerFlag(layer.id, 'solo', !layer.solo); });
    const lock = swBtn(ICON.lock, layer.locked, 'ロック');
    lock.addEventListener('click', e => { e.stopPropagation(); actions.setLayerFlag(layer.id, 'locked', !layer.locked); });
    const shy = swBtn(ICON.shy, layer.shy, 'シャイ');
    shy.addEventListener('click', e => { e.stopPropagation(); actions.setLayerFlag(layer.id, 'shy', !layer.shy); });

    const nameEl = el('span', { class: 'tl-name', text: layer.name, title: layer.name });
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      startRename(row, layer);
    });
    const mode = el('select', { class: 'tl-mode', title: 'ブレンドモード' },
      BLEND_MODES.map(([v, l]) => el('option', { value: v, text: l, selected: layer.blendMode === v })));
    mode.addEventListener('click', e => e.stopPropagation());
    mode.addEventListener('change', () => actions.setBlendMode(layer.id, mode.value));

    const left = el('div', { class: 'tl-left' },
      leftCell('c-twirl', twirl),
      leftCell('c-chip', chip),
      leftCell('c-idx', el('span', { text: String(idx + 1) })),
      leftCell('c-sw', eye, solo, lock, shy),
      leftCell('c-name', nameEl),
      leftCell('c-mode', mode),
    );

    // グラフ側: レイヤーバー
    const graph = el('div', { class: 'tl-graph' });
    const bar = el('div', {
      class: 'tl-bar type-' + layer.type,
      style: { left: t2x(layer.inTime) + 'px', width: Math.max(2, t2x(layer.outTime - layer.inTime)) + 'px' },
    },
      el('div', { class: 'tl-bar-handle left' }),
      el('div', { class: 'tl-bar-handle right' }));
    setupBarDrag(bar, layer);
    graph.append(bar);

    row.append(left, graph);
    row.addEventListener('mousedown', e => {
      if (e.target.closest('select,button,input')) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) selectLayers([layer.id], { toggle: true });
      else if (!state.selectedLayerIds.includes(layer.id)) selectLayers([layer.id]);
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!state.selectedLayerIds.includes(layer.id)) selectLayers([layer.id]);
      layerContextMenu(e.clientX, e.clientY, layer);
    });

    const rows = [row];
    if (exp.layer) rows.push(...buildTransformRows(layer, exp));
    return rows;
  }

  function swBtn(icon, on, title) {
    return el('button', { class: 'tl-sw' + (on ? ' on' : ''), html: icon, title });
  }

  function startRename(row, layer) {
    const nameCell = row.querySelector('.tl-name');
    const input = el('input', { class: 'tl-rename', type: 'text', value: layer.name });
    nameCell.replaceWith(input);
    input.focus(); input.select();
    const commit = () => { if (input.isConnected) { actions.renameLayer(layer.id, input.value.trim() || layer.name); } };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = layer.name; input.blur(); }
    });
  }

  // ---- トランスフォーム行群 ----
  function buildTransformRows(layer, exp) {
    const rows = [];
    const gRow = el('div', { class: 'tl-row tl-group-row' });
    const twirl = el('button', { class: 'tl-twirl' + (exp.transform ? ' open' : ''), text: '▸' });
    twirl.addEventListener('click', () => { exp.transform = !exp.transform; expansions.set(layer.id, exp); render(); });
    gRow.append(
      el('div', { class: 'tl-left' }, leftCell('c-twirl indent1', twirl), leftCell('c-groupname', el('span', { text: 'トランスフォーム' }))),
      el('div', { class: 'tl-graph' }));
    rows.push(gRow);
    if (!exp.transform) return rows;
    for (const prop of PROPS) rows.push(buildPropRow(layer, prop));
    return rows;
  }

  function buildPropRow(layer, prop) {
    const kfs = layer.kf[prop];
    const kfOn = kfs.length > 0;
    const row = el('div', { class: 'tl-row tl-prop-row', dataset: { layerId: layer.id, prop } });

    const sw = el('button', { class: 'tl-stopwatch' + (kfOn ? ' on' : ''), html: ICON.stopwatch, title: 'ストップウォッチ' });
    sw.addEventListener('click', () => {
      if (kfs.length && !window.confirm(`「${actions.PROP_LABELS[prop]}」のキーフレームをすべて削除しますか?`)) return;
      actions.toggleStopwatch(layer, prop);
    });
    const curIdx = actions.keyframeAt(layer, prop, state.currentTime);
    const navPrev = el('button', { class: 'tl-kfnav', text: '◄', title: '前のキーフレームへ', on: { click: () => actions.gotoKeyframe(layer, prop, -1) } });
    const navAdd = el('button', { class: 'tl-kfnav kf-add' + (curIdx >= 0 ? ' on' : ''), title: 'キーフレームの追加/削除', on: { click: () => actions.toggleKeyframeAtCurrent(layer, prop) } });
    const navNext = el('button', { class: 'tl-kfnav', text: '►', title: '次のキーフレームへ', on: { click: () => actions.gotoKeyframe(layer, prop, 1) } });

    const valueCells = buildValueInputs(layer, prop);

    row.append(
      el('div', { class: 'tl-left' },
        leftCell('c-stopwatch indent1', sw),
        leftCell('c-propname', el('span', { text: actions.PROP_LABELS[prop] })),
        leftCell('c-kfnav', navPrev, navAdd, navNext),
        leftCell('c-values', ...valueCells)),
      buildPropGraph(layer, prop));
    return row;
  }

  function buildValueInputs(layer, prop) {
    const val = actions.currentPropValue(layer, prop);
    const mk = (v, cb) => {
      const input = el('input', { class: 'tl-val', type: 'number', step: prop === 'opacity' || prop === 'scale' ? 1 : 0.1, value: fmt(v) });
      input.addEventListener('change', () => {
        const n = parseFloat(input.value);
        if (isNaN(n)) return;
        cb(n);
      });
      input.addEventListener('keydown', e => e.stopPropagation());
      return input;
    };
    if (prop === 'rotation' || prop === 'opacity') {
      return [mk(val, n => actions.setProp(layer, prop, prop === 'opacity' ? clamp(n, 0, 100) : n, { snap: true }))];
    }
    return [
      mk(val.x, n => actions.setProp(layer, prop, { x: n, y: actions.currentPropValue(layer, prop).y }, { snap: true })),
      mk(val.y, n => actions.setProp(layer, prop, { x: actions.currentPropValue(layer, prop).x, y: n }, { snap: true })),
    ];
  }
  function fmt(v) { return Math.round((+v || 0) * 100) / 100; }

  function buildPropGraph(layer, prop) {
    const graph = el('div', { class: 'tl-graph tl-kf-graph' });
    layer.kf[prop].forEach((kf, i) => {
      const isSel = state.selectedKeyframes.some(s => s.layerId === layer.id && s.prop === prop && s.index === i);
      const dia = el('div', {
        class: 'tl-kf' + (isSel ? ' selected' : '') + (kf.ease === 'ease' ? ' ease' : ''),
        style: { left: t2x(kf.time) + 'px' },
        title: secondsToTimecode(kf.time, getComp().fps),
      });
      setupKfDrag(dia, layer, prop, i);
      graph.append(dia);
    });
    return graph;
  }

  // ---- ドラッグ処理 ----
  function setupKfDrag(dia, layer, prop, index) {
    dia.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (e.button !== 0) return;
      state.uiLock = true; // selectKeyframe の 'selection' 発行でDOM再構築されるのを先に防ぐ
      actions.selectKeyframe(layer.id, prop, index, { additive: e.shiftKey });
      snapshot();
      const startX = e.clientX;
      const comp = getComp();
      const origTimes = state.selectedKeyframes.map(s => {
        const l = s.layerId === layer.id ? layer : comp.layers.find(x => x.id === s.layerId);
        return { s, time: l?.kf[s.prop]?.[s.index]?.time };
      }).filter(o => o.time != null);
      let moved = false;
      const onMove = ev => {
        const dt = x2t(ev.clientX - startX);
        if (Math.abs(ev.clientX - startX) > 2) moved = true;
        if (!moved) return;
        for (const { s, time } of origTimes) {
          const l = comp.layers.find(x => x.id === s.layerId);
          if (!l) continue;
          const kf = l.kf[s.prop][s.index];
          if (kf) kf.time = clamp(time + dt, 0, comp.duration);
        }
        // 直接DOM更新 (並び替えは mouseup 後)
        const kf = layer.kf[prop][index];
        if (kf) dia.style.left = t2x(kf.time) + 'px';
        emit('values');
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        state.uiLock = false;
        // 時間順にソートして整合
        for (const { s } of origTimes) {
          const l = comp.layers.find(x => x.id === s.layerId);
          l?.kf[s.prop]?.sort((a, b) => a.time - b.time);
        }
        state.selectedKeyframes = [];
        emit('layers'); emit('values');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  function setupBarDrag(bar, layer) {
    bar.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (e.button !== 0 || layer.locked) return;
      const comp = getComp();
      if (!comp) return;
      state.uiLock = true; // selectLayers の発行でDOM再構築されるのを先に防ぐ
      if (!state.selectedLayerIds.includes(layer.id)) selectLayers([layer.id]);
      const isLeft = e.target.classList.contains('left');
      const isRight = e.target.classList.contains('right');
      const mode = isLeft ? 'trim-l' : isRight ? 'trim-r' : 'move';
      snapshot();
      const startX = e.clientX;
      const onMove = ev => {
        const dt = x2t(ev.clientX - startX);
        if (mode === 'move') {
          const dur = layer.outTime - layer.inTime;
          const ni = clamp(origIn + dt, -dur + 1 / comp.fps, comp.duration);
          layer.inTime = ni; layer.outTime = ni + dur;
        } else if (mode === 'trim-l') {
          actions.trimLayerBar(layer.id, 'in', origIn + dt);
        } else {
          actions.trimLayerBar(layer.id, 'out', origOut + dt);
        }
        bar.style.left = t2x(layer.inTime) + 'px';
        bar.style.width = Math.max(2, t2x(layer.outTime - layer.inTime)) + 'px';
        emit('values');
      };
      const origIn = layer.inTime, origOut = layer.outTime;
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        state.uiLock = false;
        emit('layers');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  // ---- コンテキストメニュー ----
  function layerContextMenu(x, y, layer) {
    const items = [
      { label: 'レイヤー設定…', cmd: () => dialogs.layerSettingsDialog(layer) },
      { label: '名前を変更', cmd: () => { const row = inner.querySelector(`.tl-layer-row[data-layer-id="${layer.id}"]`); if (row) startRename(row, layer); } },
      '-',
      { label: '複製', cmd: () => actions.duplicateSelected() },
      { label: 'レイヤーを分割', cmd: () => actions.splitSelectedAt(state.currentTime) },
      { label: '削除', cmd: () => actions.deleteSelectedLayers() },
      '-',
      {
        label: 'ラベル', submenu: LABEL_COLORS.map(([c, n]) => ({
          label: n, swatch: c, cmd: () => actions.setLayerLabel(layer.id, c),
        })),
      },
      {
        label: '重ね順', submenu: [
          { label: '最前面へ', cmd: () => actions.reorderLayer(layer.id, 'top') },
          { label: '1つ前面へ', cmd: () => actions.reorderLayer(layer.id, 'up') },
          { label: '1つ背面へ', cmd: () => actions.reorderLayer(layer.id, 'down') },
          { label: '最背面へ', cmd: () => actions.reorderLayer(layer.id, 'bottom') },
        ],
      },
      '-',
      { label: 'トランスフォームをリセット', cmd: () => actions.resetTransform(layer.id) },
    ];
    popupMenu(items, x, y);
  }

  function popupMenu(items, x, y) {
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
    const menu = el('div', { class: 'menu-dropdown ctx-menu' });
    const build = (its, parent) => {
      for (const item of its) {
        if (item === '-') { parent.append(el('div', { class: 'menu-sep' })); continue; }
        const row = el('div', { class: 'menu-row' + (item.submenu ? ' has-sub' : '') },
          item.swatch ? el('span', { class: 'menu-swatch', style: { background: item.swatch } }) : el('span', { class: 'menu-check' }),
          el('span', { class: 'menu-label', text: item.label }),
          item.submenu ? el('span', { class: 'menu-sub-arrow', text: '▸' }) : null);
        row.addEventListener('click', e => {
          e.stopPropagation();
          if (item.submenu) return;
          document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
          item.cmd();
        });
        if (item.submenu) {
          row.addEventListener('mouseenter', () => {
            document.querySelectorAll('.menu-dropdown.sub').forEach(d => d.remove());
            const sub = el('div', { class: 'menu-dropdown sub ctx-menu' });
            build(item.submenu, sub);
            const r = row.getBoundingClientRect();
            sub.style.left = (r.right - 2) + 'px';
            sub.style.top = (r.top - 3) + 'px';
            document.body.append(sub);
          });
        }
        parent.append(row);
      }
    };
    build(items, menu);
    menu.style.left = Math.min(x, innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, innerHeight - items.length * 24 - 20) + 'px';
    document.body.append(menu);
    const close = e => {
      if (!e.target.closest('.ctx-menu')) {
        document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
        document.removeEventListener('mousedown', close);
      }
    };
    document.addEventListener('mousedown', close);
  }

  // ---- ルーラー行 ----
  function buildRulerRow(comp) {
    const rulerCanvas = el('canvas', { class: 'tl-ruler' });
    drawRuler(rulerCanvas, comp);
    rulerCanvas.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = rulerCanvas.getBoundingClientRect();
      const scrub = ev => {
        const t = clamp(x2t(ev.clientX - rect.left), 0, comp.duration);
        setTime(t);
      };
      scrub(e);
      const onUp = () => {
        window.removeEventListener('mousemove', scrub);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', scrub);
      window.addEventListener('mouseup', onUp);
    });
    // ワークエリアバー
    const wa = el('div', { class: 'tl-workarea' },
      el('div', { class: 'tl-wa-handle left' }),
      el('div', { class: 'tl-wa-handle right' }));
    updateWorkArea(wa, comp);
    wa.querySelector('.left').addEventListener('mousedown', e => waDrag(e, comp, 'start'));
    wa.querySelector('.right').addEventListener('mousedown', e => waDrag(e, comp, 'end'));

    const graphPart = el('div', { class: 'tl-graph tl-ruler-graph' }, rulerCanvas, wa);
    const row = el('div', { class: 'tl-row tl-ruler-row' },
      el('div', { class: 'tl-left tl-head-left' },
        leftCell('c-head-name', el('span', { text: 'レイヤー名' })),
        leftCell('c-head-mode', el('span', { text: 'モード' }))),
      graphPart);
    return row;
  }

  function updateWorkArea(wa, comp) {
    wa.style.left = t2x(comp.workArea.start) + 'px';
    wa.style.width = Math.max(4, t2x(comp.workArea.end - comp.workArea.start)) + 'px';
  }
  function waDrag(e, comp, which) {
    e.preventDefault(); e.stopPropagation();
    state.uiLock = true;
    const graphEl = inner.querySelector('.tl-ruler-graph');
    const rect = graphEl.getBoundingClientRect();
    const onMove = ev => {
      const t = clamp(x2t(ev.clientX - rect.left), 0, comp.duration);
      if (which === 'start') comp.workArea.start = Math.min(t, comp.workArea.end - 1 / comp.fps);
      else comp.workArea.end = Math.max(t, comp.workArea.start + 1 / comp.fps);
      const wa = inner.querySelector('.tl-workarea');
      if (wa) updateWorkArea(wa, comp);
      emit('time');
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      state.uiLock = false;
      render();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ---- 全体描画 ----
  function render() {
    const comp = getComp();
    if (titleEl) titleEl.textContent = comp ? `タイムライン: ${comp.name}` : 'タイムライン';
    // タブ
    tabs.textContent = '';
    if (state.project) {
      for (const c of Object.values(state.project.comps)) {
        const tab = el('button', { class: 'tl-tab' + (c.id === state.currentCompId ? ' active' : ''), text: c.name });
        tab.addEventListener('click', () => actions.openComposition(c.id));
        tabs.append(tab);
      }
    }
    // 本体
    const keepTop = scroll.scrollTop, keepLeft = scroll.scrollLeft;
    inner.querySelectorAll('.tl-row').forEach(r => r.remove());
    if (!comp) { updateDynamic(); return; }
    graphW = Math.ceil(comp.duration * pxPerSec) + 80;
    inner.style.minWidth = (LEFT_W + graphW) + 'px';
    inner.append(buildRulerRow(comp));
    layerCounter = 0;
    for (const layer of comp.layers) {
      if (shyMaster && layer.shy) continue;
      buildLayerRow(layer, layerCounter++).forEach(r => inner.append(r));
    }
    scroll.scrollTop = keepTop; scroll.scrollLeft = keepLeft;
    updateDynamic();
  }

  // ---- 動的更新 (再生ヘッド・時刻・値) ----
  function updateDynamic() {
    const comp = getComp();
    if (!comp) return;
    timeDisplay.textContent = secondsToTimecode(state.currentTime, comp.fps);
    const rulerRowLeft = LEFT_W;
    playhead.style.left = (rulerRowLeft + t2x(state.currentTime)) + 'px';
    const rulerCanvas = inner.querySelector('.tl-ruler');
    if (rulerCanvas) drawRuler(rulerCanvas, comp);
    // プロパティ値の更新 (フォーカス中は触らない)
    for (const row of inner.querySelectorAll('.tl-prop-row')) {
      const layer = comp.layers.find(l => l.id === row.dataset.layerId);
      if (!layer) continue;
      const prop = row.dataset.prop;
      const val = actions.currentPropValue(layer, prop);
      const inputs = row.querySelectorAll('.tl-val');
      if (prop === 'rotation' || prop === 'opacity') {
        if (document.activeElement !== inputs[0]) inputs[0].value = fmt(val);
      } else {
        if (document.activeElement !== inputs[0]) inputs[0].value = fmt(val.x);
        if (document.activeElement !== inputs[1]) inputs[1].value = fmt(val.y);
      }
      // ◆ ボタン状態
      const addBtn = row.querySelector('.kf-add');
      if (addBtn) addBtn.classList.toggle('on', actions.keyframeAt(layer, prop, state.currentTime) >= 0);
    }
  }

  bus.on('layers', () => { if (!state.uiLock) render(); else updateDynamic(); });
  bus.on('project', render);
  bus.on('selection', () => { if (!state.uiLock) render(); });
  bus.on('time', updateDynamic);
  bus.on('values', updateDynamic);
  fitZoom();
}
