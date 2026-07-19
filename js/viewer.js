// コンポジションビューア (キャンバス描画 + 直接操作)
import { el, clamp } from './utils.js';
import { state, bus, emit, getComp, snapshot, setTime, selectLayers } from './state.js';
import { evalTransform, contentSize, renderCompToCanvas, isLayerVisible } from './render.js';
import * as actions from './actions.js';
import * as dialogs from './dialogs.js';
import { registerHook } from './commands.js';

const ZOOM_LADDER = [0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16];
const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5],
  se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const OPPOSITE = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };
const HANDLE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

export function initViewer(container, titleEl) {
  const canvas = el('canvas', { class: 'viewer-canvas' });
  const body = el('div', { class: 'viewer-body' }, canvas);

  const zoomSel = el('select', { class: 'viewer-zoom' },
    ...['12.5%', '25%', '50%', '100%', '200%', '400%', '800%', 'フィット'].map(z => el('option', { text: z, value: z })));
  zoomSel.value = 'フィット';
  const resSel = el('select', { class: 'viewer-res' },
    el('option', { text: 'フル', value: '1' }),
    el('option', { text: 'ハーフ', value: '0.5' }),
    el('option', { text: '3分の1', value: '0.3334' }),
    el('option', { text: '4分の1', value: '0.25' }));
  const footer = el('div', { class: 'viewer-footer' },
    zoomSel, resSel,
    el('span', { class: 'viewer-hint', text: '' }));

  container.append(el('div', { class: 'viewer-panel' }, body, footer));
  const ctx = canvas.getContext('2d');

  // ---- ビュー変換 ----
  function currentZoom() {
    const comp = getComp();
    if (!comp) return 1;
    if (state.view.zoom === 'fit') {
      const zx = body.clientWidth / comp.width, zy = body.clientHeight / comp.height;
      return clamp(Math.min(zx, zy) * 0.92, 0.02, 16);
    }
    return state.view.zoom;
  }
  function compToScreen(p) {
    const z = currentZoom();
    return {
      x: body.clientWidth / 2 + (p.x - compWidth() / 2) * z + state.view.panX,
      y: body.clientHeight / 2 + (p.y - compHeight() / 2) * z + state.view.panY,
    };
  }
  function screenToComp(p) {
    const z = currentZoom();
    return {
      x: (p.x - body.clientWidth / 2 - state.view.panX) / z + compWidth() / 2,
      y: (p.y - body.clientHeight / 2 - state.view.panY) / z + compHeight() / 2,
    };
  }
  const compWidth = () => getComp()?.width || 1;
  const compHeight = () => getComp()?.height || 1;

  function setZoom(z) {
    state.view.zoom = clamp(z, 0.02, 16);
    syncZoomSel();
    emit('view');
  }
  function syncZoomSel() {
    const z = state.view.zoom;
    if (z === 'fit') { zoomSel.value = 'フィット'; return; }
    const label = `${Math.round(z * 10000) / 100}%`;
    if (![...zoomSel.options].some(o => o.value === label)) {
      zoomSel.append(el('option', { text: label, value: label, class: 'zoom-custom' }));
    }
    zoomSel.value = label;
  }
  zoomSel.addEventListener('change', () => {
    if (zoomSel.value === 'フィット') { state.view.zoom = 'fit'; state.view.panX = 0; state.view.panY = 0; }
    else state.view.zoom = parseFloat(zoomSel.value) / 100;
    emit('view');
  });
  resSel.addEventListener('change', () => { state.view.res = parseFloat(resSel.value); emit('view'); });

  function zoomStep(dir) {
    const z = state.view.zoom === 'fit' ? currentZoom() : state.view.zoom;
    let next = z;
    if (dir > 0) next = ZOOM_LADDER.find(v => v > z * 1.001) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1];
    else next = [...ZOOM_LADDER].reverse().find(v => v < z * 0.999) ?? ZOOM_LADDER[0];
    setZoom(next);
  }
  registerHook('zoomIn', () => zoomStep(1));
  registerHook('zoomOut', () => zoomStep(-1));
  registerHook('zoomFit', () => { state.view.zoom = 'fit'; state.view.panX = 0; state.view.panY = 0; syncZoomSel(); emit('view'); });
  registerHook('zoom100', () => setZoom(1));

  // ---- 描画 ----
  let dirty = true;
  function markDirty() { dirty = true; }
  ['time', 'values', 'layers', 'selection', 'view', 'tool', 'project'].forEach(t => bus.on(t, () => { updateTitle(); markDirty(); }));

  function updateTitle() {
    const comp = getComp();
    if (titleEl) titleEl.textContent = comp ? `コンポジション: ${comp.name}` : 'コンポジション';
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, body.clientWidth * dpr);
    canvas.height = Math.max(1, body.clientHeight * dpr);
    canvas.style.width = body.clientWidth + 'px';
    canvas.style.height = body.clientHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    markDirty();
  }
  new ResizeObserver(resize).observe(body);

  function draw() {
    const w = body.clientWidth, h = body.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, w, h);
    const comp = getComp();
    if (!comp) return;
    const z = currentZoom();
    const tl = compToScreen({ x: 0, y: 0 });
    // コンポフレーム
    const frame = renderCompToCanvas(comp, state.currentTime, state.view.res);
    ctx.imageSmoothingEnabled = z <= 1.01;
    ctx.drawImage(frame, tl.x, tl.y, comp.width * z, comp.height * z);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x - 0.5, tl.y - 0.5, comp.width * z + 1, comp.height * z + 1);
    // 選択オーバーレイ
    drawSelection(comp);
  }

  function layerMatrix(tr) {
    // p_comp = pos + R*S*(p_local - anchor)
    const rot = (tr.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const sx = (tr.scale?.x ?? 100) / 100, sy = (tr.scale?.y ?? 100) / 100;
    return {
      apply(p) {
        const dx = p.x - tr.anchor.x, dy = p.y - tr.anchor.y;
        const px = dx * sx, py = dy * sy;
        return { x: tr.position.x + px * cos - py * sin, y: tr.position.y + px * sin + py * cos };
      },
      invert(p) {
        const dx = p.x - tr.position.x, dy = p.y - tr.position.y;
        const rx = dx * cos + dy * sin, ry = -dx * sin + dy * cos;
        return { x: rx / sx + tr.anchor.x, y: ry / sy + tr.anchor.y };
      },
      rotateVec(v) { return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }; },
      invRotateVec(v) { return { x: v.x * cos + v.y * sin, y: -v.x * sin + v.y * cos }; },
    };
  }

  function drawSelection(comp) {
    const z = currentZoom();
    const soloActive = comp.layers.some(l => l.solo && l.enabled);
    for (const layer of comp.layers) {
      if (!state.selectedLayerIds.includes(layer.id)) continue;
      if (!isLayerVisible(layer, state.currentTime, soloActive)) continue;
      const tr = evalTransform(layer, state.currentTime);
      const { w, h } = contentSize(layer, comp);
      const M = layerMatrix(tr);
      const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map(p => compToScreen(M.apply(p)));
      ctx.strokeStyle = '#4f9cf0';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.stroke();
      // ハンドル
      for (const [name, [fx, fy]] of Object.entries(HANDLE_POS)) {
        const p = compToScreen(M.apply({ x: w * fx, y: h * fy }));
        ctx.fillStyle = '#1e1e1e';
        ctx.strokeStyle = '#4f9cf0';
        ctx.beginPath();
        ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7);
        ctx.fill(); ctx.stroke();
      }
      // アンカーポイント
      const a = compToScreen(M.apply(tr.anchor));
      ctx.strokeStyle = '#4f9cf0';
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.moveTo(a.x - 6, a.y); ctx.lineTo(a.x + 6, a.y);
      ctx.moveTo(a.x, a.y - 6); ctx.lineTo(a.x, a.y + 6);
      ctx.stroke();
    }
  }

  // ---- ヒットテスト ----
  function hitTest(screenPt) {
    const comp = getComp();
    if (!comp) return null;
    const pt = screenToComp(screenPt);
    const soloActive = comp.layers.some(l => l.solo && l.enabled);
    for (const layer of comp.layers) {
      if (!isLayerVisible(layer, state.currentTime, soloActive) || layer.locked) continue;
      const tr = evalTransform(layer, state.currentTime);
      const { w, h } = contentSize(layer, comp);
      const M = layerMatrix(tr);
      // ハンドル (選択中のみ)
      if (state.selectedLayerIds.includes(layer.id) && state.tool === 'selection') {
        for (const [name, [fx, fy]] of Object.entries(HANDLE_POS)) {
          const p = compToScreen(M.apply({ x: w * fx, y: h * fy }));
          if (Math.abs(screenPt.x - p.x) <= 5 && Math.abs(screenPt.y - p.y) <= 5) {
            return { kind: 'handle', layer, handle: name, M, tr, w, h };
          }
        }
      }
      const local = M.invert(pt);
      if (local.x >= 0 && local.x <= w && local.y >= 0 && local.y <= h) {
        return { kind: 'body', layer, M, tr, w, h };
      }
    }
    return null;
  }

  // ---- マウス操作 ----
  let drag = null;
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const comp = getComp();
    if (!comp) return;
    const rect = canvas.getBoundingClientRect();
    const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const cp = screenToComp(sp);

    if (state.tool === 'hand') {
      drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: state.view.panX, panY: state.view.panY };
      return;
    }
    if (state.tool === 'zoom') {
      zoomStep(e.altKey ? -1 : 1);
      return;
    }
    if (state.tool === 'text') {
      const layer = actions.newTextLayer({ position: cp });
      if (layer) dialogs.textSettingsDialog(layer);
      return;
    }
    if (state.tool === 'rect' || state.tool === 'ellipse') {
      drag = { kind: 'shape', shape: state.tool, start: cp, cur: cp };
      state.uiLock = true;
      return;
    }
    // 選択 / 回転ツール
    const hit = hitTest(sp);
    if (state.tool === 'rotate') {
      if (hit && hit.kind === 'body') {
        if (!state.selectedLayerIds.includes(hit.layer.id)) selectLayers([hit.layer.id]);
        const a = compToScreen(hit.M.apply(hit.tr.anchor));
        drag = {
          kind: 'rotate', layer: hit.layer,
          center: a, startAngle: Math.atan2(sp.y - a.y, sp.x - a.x),
          startRot: evalTransform(hit.layer, state.currentTime).rotation || 0,
        };
        snapshot();
        state.uiLock = true;
      }
      return;
    }
    if (!hit) {
      if (!e.shiftKey) selectLayers([]);
      return;
    }
    if (hit.kind === 'handle') {
      const fixedLocal = HANDLE_POS[OPPOSITE[hit.handle]];
      const fixedPt = { x: hit.w * fixedLocal[0], y: hit.w * fixedLocal[1] };
      drag = {
        kind: 'scale', layer: hit.layer, handle: hit.handle,
        w: hit.w, h: hit.h,
        fixedLocal: fixedPt, fixedComp: hit.M.apply(fixedPt),
        anchor: { ...hit.tr.anchor }, shift: false,
      };
      snapshot();
      state.uiLock = true;
      return;
    }
    // ボディ: 選択して移動
    if (e.shiftKey) {
      selectLayers([hit.layer.id], { toggle: true });
    } else if (!state.selectedLayerIds.includes(hit.layer.id)) {
      selectLayers([hit.layer.id]);
    }
    drag = {
      kind: 'move', start: cp,
      orig: selectedLayersTransforms(),
    };
    snapshot();
    state.uiLock = true;
  });

  function selectedLayersTransforms() {
    const comp = getComp();
    const map = {};
    for (const layer of comp.layers) {
      if (state.selectedLayerIds.includes(layer.id) && !layer.locked) {
        const tr = evalTransform(layer, state.currentTime);
        map[layer.id] = { layer, x: tr.position.x, y: tr.position.y };
      }
    }
    return map;
  }
  window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const comp = getComp();
    if (!drag) {
      // カーソル更新 + 情報パネル用ポインタ座標
      if (comp) {
        const cp = screenToComp(sp);
        bus.emit('pointer', { x: Math.round(cp.x), y: Math.round(cp.y) });
        updateCursor(sp);
      }
      return;
    }
    const cp = screenToComp(sp);
    if (drag.kind === 'pan') {
      state.view.panX = drag.panX + (e.clientX - drag.startX);
      state.view.panY = drag.panY + (e.clientY - drag.startY);
      if (state.view.zoom === 'fit') state.view.zoom = currentZoom();
      markDirty();
      return;
    }
    if (drag.kind === 'shape') {
      drag.cur = cp;
      markDirty();
      drawRubberBand();
      return;
    }
    if (drag.kind === 'move') {
      let dx = cp.x - drag.start.x, dy = cp.y - drag.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      for (const { layer, x, y } of Object.values(drag.orig)) {
        actions.setProp(layer, 'position', { x: x + dx, y: y + dy });
      }
      return;
    }
    if (drag.kind === 'rotate') {
      const ang = Math.atan2(sp.y - drag.center.y, sp.x - drag.center.x);
      let deg = drag.startRot + (ang - drag.startAngle) * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 45) * 45;
      actions.setProp(drag.layer, 'rotation', Math.round(deg * 100) / 100);
      return;
    }
    if (drag.kind === 'scale') {
      const tr = evalTransform(drag.layer, state.currentTime);
      const M = layerMatrix(tr);
      const v = M.invRotateVec({ x: cp.x - drag.fixedComp.x, y: cp.y - drag.fixedComp.y });
      const handleLocal = HANDLE_POS[drag.handle];
      const hp = { x: drag.w * handleLocal[0], y: drag.h * handleLocal[1] };
      const d = { x: hp.x - drag.fixedLocal.x, y: hp.y - drag.fixedLocal.y };
      let sx = tr.scale.x / 100, sy = tr.scale.y / 100;
      if (Math.abs(d.x) > 0.001) sx = v.x / d.x;
      if (Math.abs(d.y) > 0.001) sy = v.y / d.y;
      if (e.shiftKey && Math.abs(d.x) > 0.001 && Math.abs(d.y) > 0.001) {
        const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
        sx = Math.sign(sx) * Math.abs(s); sy = Math.sign(sy) * Math.abs(s);
      }
      const newScale = { x: Math.round(sx * 10000) / 100, y: Math.round(sy * 10000) / 100 };
      // 位置補正: fixedComp = pos + R*S*(fixedLocal - anchor)
      const sc = { x: sx, y: sy };
      const off = M.rotateVec({ x: (drag.fixedLocal.x - drag.anchor.x) * sc.x, y: (drag.fixedLocal.y - drag.anchor.y) * sc.y });
      const newPos = { x: drag.fixedComp.x - off.x, y: drag.fixedComp.y - off.y };
      actions.setProp(drag.layer, 'scale', newScale);
      actions.setProp(drag.layer, 'position', { x: Math.round(newPos.x * 100) / 100, y: Math.round(newPos.y * 100) / 100 });
      return;
    }
  });

  window.addEventListener('mouseup', e => {
    if (!drag) return;
    if (drag.kind === 'shape') {
      const r = normRect(drag.start, drag.cur);
      if (r.w > 2 && r.h > 2) actions.newShapeLayer(drag.shape, r, state.shapeFill);
      rubber?.remove(); rubber = null;
    }
    drag = null;
    state.uiLock = false;
    emit('layers');
    markDirty();
  });

  function normRect(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }
  let rubber = null;
  function drawRubberBand() {
    if (!rubber) {
      rubber = el('div', { class: 'rubber-band' });
      body.append(rubber);
    }
    const a = compToScreen(drag.start), b = compToScreen(drag.cur);
    const r = normRect(a, b);
    Object.assign(rubber.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  function updateCursor(sp) {
    if (state.tool === 'hand') { canvas.style.cursor = drag?.kind === 'pan' ? 'grabbing' : 'grab'; return; }
    if (state.tool === 'zoom') { canvas.style.cursor = 'zoom-in'; return; }
    if (state.tool === 'text') { canvas.style.cursor = 'text'; return; }
    if (state.tool === 'rect' || state.tool === 'ellipse') { canvas.style.cursor = 'crosshair'; return; }
    if (state.tool === 'rotate') { canvas.style.cursor = 'crosshair'; return; }
    const hit = hitTest(sp);
    canvas.style.cursor = hit?.kind === 'handle' ? HANDLE_CURSORS[hit.handle] : 'default';
  }

  // ダブルクリック: テキスト編集 / ソリッド設定
  canvas.addEventListener('dblclick', e => {
    if (state.tool !== 'selection') return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (hit?.kind === 'body') {
      if (hit.layer.type === 'text') dialogs.textSettingsDialog(hit.layer);
      else if (hit.layer.type === 'solid') dialogs.solidSettingsDialog(hit.layer);
    }
  });

  // ホイールズーム
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const comp = getComp();
    if (!comp) return;
    const rect = canvas.getBoundingClientRect();
    const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const before = screenToComp(sp);
    const z = state.view.zoom === 'fit' ? currentZoom() : state.view.zoom;
    const nz = clamp(z * Math.pow(1.0015, -e.deltaY), 0.02, 16);
    state.view.zoom = nz;
    // カーソル位置を維持
    const zAfter = currentZoom();
    state.view.panX = sp.x - body.clientWidth / 2 - (before.x - comp.width / 2) * zAfter;
    state.view.panY = sp.y - body.clientHeight / 2 - (before.y - comp.height / 2) * zAfter;
    syncZoomSel();
    markDirty();
  }, { passive: false });

  // ---- WebM 書き出し ----
  window.addEventListener('openEffect:exportWebM', async ev => {
    const comp = getComp();
    if (!comp) return;
    const [t0, t1] = ev.detail?.range === 'full'
      ? [0, comp.duration]
      : [comp.workArea.start, comp.workArea.end];
    const off = document.createElement('canvas');
    off.width = comp.width; off.height = comp.height;
    const octx = off.getContext('2d');
    let mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    const stream = off.captureStream(comp.fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = e2 => e2.data.size && chunks.push(e2.data);
    const done = new Promise(r => rec.onstop = r);
    const overlay = el('div', { class: 'export-overlay' },
      el('div', { class: 'export-box' },
        el('div', { class: 'export-title', text: 'WebM 書き出し中…' }),
        el('div', { class: 'export-progress', text: '0%' })));
    document.body.append(overlay);
    const prog = overlay.querySelector('.export-progress');
    const prevTime = state.currentTime;
    state.uiLock = true;
    rec.start();
    const frameDur = 1 / comp.fps;
    const total = Math.round((t1 - t0) * comp.fps);
    for (let f = 0; f < total; f++) {
      const t = t0 + f * frameDur;
      const frame = renderCompToCanvas(comp, t, 1);
      octx.drawImage(frame, 0, 0);
      setTime(t);
      prog.textContent = Math.round(f / total * 100) + '%';
      await new Promise(r => setTimeout(r, frameDur * 1000));
    }
    rec.stop();
    await done;
    state.uiLock = false;
    setTime(prevTime);
    overlay.remove();
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = comp.name + '.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });

  // ---- メインループ ----
  function loop() {
    if (dirty) { dirty = false; draw(); }
    requestAnimationFrame(loop);
  }
  updateTitle();
  loop();
}
