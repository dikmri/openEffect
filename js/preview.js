// プレビューパネル (再生コントロール) + 情報パネル + 再生エンジン
import { el, secondsToTimecode, durationToTimecode } from './utils.js';
import { state, bus, emit, getComp, setTime } from './state.js';
import { registerHook } from './commands.js';

let playing = false;
let loopEnabled = true;
let rafId = null;
let lastTs = 0;
let playFrom = 0;
let playStartedAt = 0;

export function isPlaying() { return playing; }

export function stopPlayback() {
  if (!playing) return;
  playing = false;
  state.playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  document.querySelectorAll('.pv-play').forEach(b => b.classList.remove('active'));
  emit('playback');
}

export function startPlayback() {
  const comp = getComp();
  if (!comp || playing) return;
  playing = true;
  state.playing = true;
  playFrom = state.currentTime;
  if (playFrom >= comp.workArea.end - 1e-6 || playFrom < comp.workArea.start) playFrom = comp.workArea.start;
  playStartedAt = performance.now();
  lastTs = playStartedAt;
  document.querySelectorAll('.pv-play').forEach(b => b.classList.add('active'));
  emit('playback');
  rafId = requestAnimationFrame(tick);
}

export function togglePlayback() {
  if (playing) stopPlayback();
  else startPlayback();
}

function tick(ts) {
  if (!playing) return;
  const comp = getComp();
  if (!comp) { stopPlayback(); return; }
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;
  let t = state.currentTime + dt;
  // フレーム単位に量子化
  t = Math.floor(t * comp.fps) / comp.fps;
  if (t >= comp.workArea.end) {
    if (loopEnabled) t = comp.workArea.start;
    else { setTime(comp.workArea.end - 1 / comp.fps); stopPlayback(); return; }
  }
  setTime(t);
  rafId = requestAnimationFrame(tick);
}

registerHook('togglePlay', togglePlayback);

// ---- プレビューパネル ----
export function initPreviewPanel(container) {
  const btnFirst = pvBtn('⏮', '最初のフレーム (Home)');
  const btnPrev = pvBtn('◀', '前のフレーム (PageUp)');
  const btnPlay = pvBtn('▶', '再生/停止 (スペース)');
  btnPlay.classList.add('pv-play');
  const btnNext = pvBtn('▶|', '次のフレーム (PageDown)');
  const btnLast = pvBtn('⏭', '最後のフレーム (End)');
  const loopBtn = el('button', { class: 'pv-btn loop' + (loopEnabled ? ' active' : ''), text: '🔁', title: 'ループ再生' });

  btnFirst.addEventListener('click', () => { const c = getComp(); if (c) setTime(c.workArea.start); });
  btnLast.addEventListener('click', () => { const c = getComp(); if (c) setTime(c.workArea.end - 1 / c.fps); });
  btnPrev.addEventListener('click', () => stepFrame(-1));
  btnNext.addEventListener('click', () => stepFrame(1));
  btnPlay.addEventListener('click', togglePlayback);
  loopBtn.addEventListener('click', () => {
    loopEnabled = !loopEnabled;
    loopBtn.classList.toggle('active', loopEnabled);
  });

  container.append(el('div', { class: 'preview-panel' },
    el('div', { class: 'pv-row' },
      el('span', { class: 'pv-caption', text: 'プレビュー' })),
    el('div', { class: 'pv-row pv-btns' }, btnFirst, btnPrev, btnPlay, btnNext, btnLast),
    el('div', { class: 'pv-row' },
      loopBtn,
      el('span', { class: 'pv-note', text: 'ショートカット: スペース = 再生' })),
  ));
}

export function stepFrame(dir) {
  const comp = getComp();
  if (!comp) return;
  const f = 1 / comp.fps;
  setTime(Math.round((state.currentTime + dir * f) * comp.fps) / comp.fps);
}

function pvBtn(label, title) {
  return el('button', { class: 'pv-btn', text: label, title });
}

// ---- 情報パネル ----
export function initInfoPanel(container) {
  const timeEl = el('div', { class: 'info-row' });
  const compEl = el('div', { class: 'info-row' });
  const posEl = el('div', { class: 'info-row' });
  container.append(el('div', { class: 'info-panel' }, timeEl, compEl, posEl));

  function render() {
    const comp = getComp();
    if (!comp) {
      timeEl.textContent = 'コンポジションがありません';
      compEl.textContent = '';
      posEl.textContent = '';
      return;
    }
    timeEl.textContent = `現在時間: ${secondsToTimecode(state.currentTime, comp.fps)}`;
    compEl.textContent = `${comp.width}×${comp.height} / ${comp.fps}fps / ${durationToTimecode(comp.duration, comp.fps)}`;
  }
  bus.on('time', render);
  bus.on('layers', render);
  bus.on('project', render);
  bus.on('pointer', p => {
    posEl.textContent = `ポインタ: X ${p.x}, Y ${p.y}`;
  });
  render();
}
