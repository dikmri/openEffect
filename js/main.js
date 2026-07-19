// エントリポイント: レイアウト構築・ショートカット・起動
import { el } from './utils.js';
import { state, bus, emitAll, createDefaultProject, loadLocal, saveLocal, selectLayers, setTime, getComp } from './state.js';
import { initMenubar } from './menubar.js';
import { initToolbar, setTool, toolFromKey } from './toolbar.js';
import { initProjectPanel } from './projectPanel.js';
import { initEffectControls, initEffectsPresets } from './effectControls.js';
import { initViewer } from './viewer.js';
import { initTimeline } from './timeline.js';
import { initPreviewPanel, initInfoPanel, togglePlayback, stepFrame, stopPlayback } from './preview.js';
import { runCommand, registerHook } from './commands.js';
import * as actions from './actions.js';

// ---- プロジェクト読み込み ----
if (!loadLocal() || !state.project || !Object.keys(state.project.comps).length) {
  createDefaultProject();
}
if (!state.currentCompId || !state.project.comps[state.currentCompId]) {
  state.currentCompId = Object.keys(state.project.comps)[0] || null;
}

// ---- レイアウト ----
const app = document.getElementById('app');
const menuHost = el('div', { id: 'menubar-host' });
const toolHost = el('div', { id: 'toolbar-host' });

// パネルフレーム生成
function panelFrame(tabTitles, activeIdx = 0) {
  const tabsEl = el('div', { class: 'panel-tabs' });
  const content = el('div', { class: 'panel-content' });
  const frame = el('div', { class: 'panel' }, tabsEl, content);
  const pages = tabTitles.map((title, i) => {
    const page = el('div', { class: 'panel-page', style: { display: i === activeIdx ? 'flex' : 'none' } });
    content.append(page);
    return page;
  });
  let active = activeIdx;
  const tabBtns = tabTitles.map((title, i) => {
    const btn = el('button', { class: 'panel-tab' + (i === active ? ' active' : ''), text: title });
    btn.addEventListener('click', () => activate(i));
    tabsEl.append(btn);
    return btn;
  });
  tabsEl.append(el('span', { class: 'panel-menu-btn', text: '≡', title: 'パネルメニュー' }));
  function activate(i) {
    active = i;
    tabBtns.forEach((b, j) => b.classList.toggle('active', j === i));
    pages.forEach((p, j) => p.style.display = j === i ? 'flex' : 'none');
  }
  return { frame, pages, activate, tabBtns };
}

// 左カラム: プロジェクト / エフェクトコントロール
const leftPanel = panelFrame(['プロジェクト', 'エフェクトコントロール']);
const colLeft = el('div', { id: 'col-left', class: 'col' }, leftPanel.frame);

// 中央: コンポジションビューア
const viewerTitle = el('span');
const centerPanel = panelFrame(['コンポジション']);
centerPanel.tabBtns[0].replaceWith(el('span', { class: 'panel-tab active dynamic' }, viewerTitle));
const colCenter = el('div', { id: 'col-center', class: 'col' }, centerPanel.frame);

// 右カラム: 情報 / プレビュー / エフェクト＆プリセット
const infoPanel = panelFrame(['情報']);
const previewPanel = panelFrame(['プレビュー']);
const effectsPanel = panelFrame(['エフェクト＆プリセット']);
const colRight = el('div', { id: 'col-right', class: 'col' }, infoPanel.frame, previewPanel.frame, effectsPanel.frame);

// タイムライン
const tlTitle = el('span');
const tlPanel = panelFrame(['タイムライン']);
tlPanel.tabBtns[0].replaceWith(el('span', { class: 'panel-tab active dynamic' }, tlTitle));

// スプリッター (Pointer Capture で確実にドラッグ終了を捕捉)
let activeSplitter = null;
function splitter(dir, onDrag) {
  const s = el('div', { class: 'splitter ' + dir });
  s.addEventListener('pointerdown', e => {
    e.preventDefault();
    activeSplitter = s;
    s.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const onMove = ev => onDrag(ev.clientX - startX, ev.clientY - startY, ev);
    const onEnd = () => {
      s.removeEventListener('pointermove', onMove);
      s.removeEventListener('pointerup', onEnd);
      s.removeEventListener('pointercancel', onEnd);
      activeSplitter = null;
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    s.addEventListener('pointermove', onMove);
    s.addEventListener('pointerup', onEnd);
    s.addEventListener('pointercancel', onEnd);
  });
  return s;
}
// 安全策: ドラッグ中でないのに resizing クラスが残っていたら解除
document.addEventListener('pointerdown', () => {
  if (!activeSplitter) document.body.classList.remove('resizing');
}, true);

const spLeft = splitter('v', (dx, dy, ev) => {
  const w = colLeft.getBoundingClientRect().width;
  colLeft.style.flexBasis = Math.max(160, Math.min(600, ev.clientX - colLeft.getBoundingClientRect().left)) + 'px';
});
const spRight = splitter('v', (dx, dy, ev) => {
  const r = colRight.getBoundingClientRect();
  colRight.style.flexBasis = Math.max(180, Math.min(560, r.right - ev.clientX)) + 'px';
});
const tlWrap = el('div', { id: 'timeline-wrap' }, tlPanel.frame);
const spBottom = splitter('h', (dx, dy, ev) => {
  tlWrap.style.height = Math.max(140, Math.min(window.innerHeight - 200, window.innerHeight - ev.clientY - 4)) + 'px';
});

const mainRow = el('div', { id: 'main-row' }, colLeft, spLeft, colCenter, spRight, colRight);
app.append(menuHost, toolHost, mainRow, spBottom, tlWrap);

// ---- パネル表示切替 (ウィンドウメニュー) ----
function applyPanelVisibility() {
  const p = state.panels;
  // 左カラム
  const showLeft = p.project || p.effectControls;
  colLeft.style.display = showLeft ? 'flex' : 'none';
  spLeft.style.display = showLeft ? 'block' : 'none';
  if (showLeft) leftPanel.activate(p.project ? 0 : 1);
  // 右カラム
  infoPanel.frame.style.display = p.info ? 'flex' : 'none';
  previewPanel.frame.style.display = p.preview ? 'flex' : 'none';
  effectsPanel.frame.style.display = p.effects ? 'flex' : 'none';
  const showRight = p.info || p.preview || p.effects;
  colRight.style.display = showRight ? 'flex' : 'none';
  spRight.style.display = showRight ? 'block' : 'none';
  // タイムライン
  tlWrap.style.display = p.timeline ? 'flex' : 'none';
  spBottom.style.display = p.timeline ? 'block' : 'none';
}
registerHook('panelToggle', id => {
  state.panels[id] = state.panels[id] === false; // undefined→true 扱い
  if (id === 'project' && !state.panels.project && !state.panels.effectControls) state.panels.effectControls = true;
  if (id === 'effectControls' && !state.panels.effectControls && !state.panels.project) state.panels.project = true;
  applyPanelVisibility();
});
applyPanelVisibility();

// ---- 各モジュール初期化 ----
initMenubar(menuHost);
initToolbar(toolHost);
initProjectPanel(leftPanel.pages[0]);
initEffectControls(leftPanel.pages[1]);
initViewer(centerPanel.pages[0], viewerTitle);
initTimeline(tlPanel.pages[0], tlTitle);
initInfoPanel(infoPanel.pages[0]);
initPreviewPanel(previewPanel.pages[0]);
initEffectsPresets(effectsPanel.pages[0]);

// ---- 自動保存 (変更のたびにデバウンス) ----
let saveTimer = null;
for (const t of ['layers', 'project', 'values']) {
  bus.on(t, () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveLocal(), 1500);
  });
}

// ---- グローバルショートカット ----
document.addEventListener('keydown', e => {
  const t = e.target;
  if (t.closest('.dlg-overlay') || t.matches('input, textarea, select') || t.isContentEditable) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;

  if (key === ' ') { e.preventDefault(); togglePlayback(); return; }
  if (mod && key.toLowerCase() === 'z') { e.preventDefault(); runCommand(e.shiftKey ? 'edit.redo' : 'edit.undo'); return; }
  if (mod && key.toLowerCase() === 'y') { e.preventDefault(); runCommand('edit.redo'); return; }
  if (mod && key.toLowerCase() === 's') { e.preventDefault(); runCommand('file.save'); return; }
  if (mod && key.toLowerCase() === 'n') { e.preventDefault(); runCommand('comp.new'); return; }
  if (mod && key.toLowerCase() === 'k') { e.preventDefault(); runCommand('comp.settings'); return; }
  if (mod && key.toLowerCase() === 'i') { e.preventDefault(); runCommand('file.import'); return; }
  if (mod && key.toLowerCase() === 'o') { e.preventDefault(); runCommand('file.open'); return; }
  if (mod && key.toLowerCase() === 'a') { e.preventDefault(); runCommand(e.shiftKey ? 'edit.deselect' : 'edit.selectAll'); return; }
  if (mod && key.toLowerCase() === 'd') { e.preventDefault(); runCommand(e.shiftKey ? 'edit.split' : 'edit.duplicate'); return; }
  if (mod && key === ']') { e.preventDefault(); runCommand(e.shiftKey ? 'layer.orderTop' : 'layer.orderUp'); return; }
  if (mod && key === '[') { e.preventDefault(); runCommand(e.shiftKey ? 'layer.orderBottom' : 'layer.orderDown'); return; }
  if (mod) return;

  if (key === 'Delete' || key === 'Backspace') {
    if (state.selectedKeyframes.length) runCommand('anim.deleteKf');
    else runCommand('edit.delete');
    return;
  }
  if (key === 'Escape') { selectLayers([]); stopPlayback(); return; }
  if (key === 'Home') { const c = getComp(); if (c) setTime(c.workArea.start); return; }
  if (key === 'End') { const c = getComp(); if (c) setTime(c.workArea.end - 1 / c.fps); return; }
  if (key === 'PageDown') { e.preventDefault(); stepFrame(1); return; }
  if (key === 'PageUp') { e.preventDefault(); stepFrame(-1); return; }
  if (key === 'ArrowRight' && mod) { stepFrame(1); return; }
  if (key.toLowerCase() === 'b') { const c = getComp(); if (c) actions.setWorkArea('start', state.currentTime); return; }
  if (key.toLowerCase() === 'n') { const c = getComp(); if (c) actions.setWorkArea('end', state.currentTime); return; }
  if (key === 'F9') { runCommand('anim.ease'); return; }
  if (key === '.') { runCommand('view.zoomIn'); return; }
  if (key === ',') { runCommand('view.zoomOut'); return; }
  if (e.altKey && key === '[') { e.preventDefault(); runCommand('layer.trimIn'); return; }
  if (e.altKey && key === ']') { e.preventDefault(); runCommand('layer.trimOut'); return; }

  // ツール切替
  const tool = toolFromKey(key, e.shiftKey);
  if (tool && !e.altKey) setTool(tool);
});

// URL パラメータで初期時間指定 (動作確認用): ?t=1.5
const initT = parseFloat(new URLSearchParams(location.search).get('t'));
if (!isNaN(initT)) setTime(initT);

// デバッグ/自動テスト用ハンドル
window.openEffect = { state, getComp, setTime };

// 初期描画
emitAll();
