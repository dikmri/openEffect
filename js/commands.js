// コマンドレジストリ: メニュー・ショートカット・ボタンから共通実行
import { state, getComp, selectedLayers, selectLayers, setTime, saveLocal, exportProjectJSON, importProjectJSON, createDefaultProject, undo, redo, canUndo, canRedo, emit } from './state.js';
import * as actions from './actions.js';
import * as dialogs from './dialogs.js';
import { EFFECTS } from './effects.js';

// viewer/preview からの遅延バインド (循環参照回避)
const hooks = { zoomIn: null, zoomOut: null, zoomFit: null, zoom100: null, togglePlay: null, exportWebM: null, panelToggle: null };
export function registerHook(name, fn) { hooks[name] = fn; }

function firstSelected() { return selectedLayers()[0] || null; }

export const COMMANDS = {
  // ファイル
  'file.newProject': () => dialogs.confirmDialog('現在のプロジェクトを破棄して新規プロジェクトを作成しますか?', () => { createDefaultProject(); emit('project'); emit('layers'); emit('time'); emit('selection'); emit('view'); }),
  'file.open': () => dialogs.pickFiles('.json,application/json', false, files => {
    const f = files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { importProjectJSON(r.result); } catch (e) { alert('プロジェクトファイルを読み込めませんでした。'); } };
    r.readAsText(f);
  }),
  'file.save': () => {
    const ok = saveLocal();
    const blob = new Blob([exportProjectJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.project.name || 'project') + '.oeprj.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (!ok) alert('ブラウザへの自動保存に失敗しました (容量不足の可能性)。ファイルには保存しました。');
  },
  'file.import': () => dialogs.pickFiles('image/*,video/*', true, files => actions.importFootageFiles(files)),
  'file.exportWebM': () => dialogs.exportWebMDialog(),

  // 編集
  'edit.undo': () => { if (canUndo()) undo(); },
  'edit.redo': () => { if (canRedo()) redo(); },
  'edit.delete': () => actions.deleteSelectedLayers(),
  'edit.duplicate': () => actions.duplicateSelected(),
  'edit.split': () => actions.splitSelectedAt(state.currentTime),
  'edit.selectAll': () => { const c = getComp(); if (c) selectLayers(c.layers.map(l => l.id)); },
  'edit.deselect': () => selectLayers([]),

  // コンポジション
  'comp.new': () => dialogs.newCompDialog(),
  'comp.settings': () => dialogs.compSettingsDialog(),

  // レイヤー
  'layer.newText': () => actions.newTextLayer(),
  'layer.newSolid': () => dialogs.newSolidDialog(),
  'layer.settings': () => { const l = firstSelected(); if (l) dialogs.layerSettingsDialog(l); },
  'layer.delete': () => actions.deleteSelectedLayers(),
  'layer.duplicate': () => actions.duplicateSelected(),
  'layer.split': () => actions.splitSelectedAt(state.currentTime),
  'layer.resetTransform': () => { const l = firstSelected(); if (l) actions.resetTransform(l.id); },
  'layer.orderTop': () => selectedLayers().forEach(l => actions.reorderLayer(l.id, 'top')),
  'layer.orderUp': () => selectedLayers().forEach(l => actions.reorderLayer(l.id, 'up')),
  'layer.orderDown': () => selectedLayers().forEach(l => actions.reorderLayer(l.id, 'down')),
  'layer.orderBottom': () => selectedLayers().forEach(l => actions.reorderLayer(l.id, 'bottom')),
  'layer.trimIn': () => selectedLayers().forEach(l => actions.trimLayerEdge(l.id, 'in', state.currentTime)),
  'layer.trimOut': () => selectedLayers().forEach(l => actions.trimLayerEdge(l.id, 'out', state.currentTime)),

  // アニメーション
  'anim.ease': () => actions.easeSelectedKeyframes('ease'),
  'anim.linear': () => actions.easeSelectedKeyframes('linear'),
  'anim.deleteKf': () => actions.deleteSelectedKeyframes(),

  // 表示
  'view.zoomIn': () => hooks.zoomIn?.(),
  'view.zoomOut': () => hooks.zoomOut?.(),
  'view.fit': () => hooks.zoomFit?.(),
  'view.100': () => hooks.zoom100?.(),

  // ウィンドウ
  'window.project': () => hooks.panelToggle?.('project'),
  'window.effectControls': () => hooks.panelToggle?.('effectControls'),
  'window.info': () => hooks.panelToggle?.('info'),
  'window.preview': () => hooks.panelToggle?.('preview'),
  'window.effects': () => hooks.panelToggle?.('effects'),
  'window.timeline': () => hooks.panelToggle?.('timeline'),

  // ヘルプ
  'help.about': () => dialogs.aboutDialog(),

  // 再生
  'transport.play': () => hooks.togglePlay?.(),
};

export function runCommand(id) {
  const cmd = COMMANDS[id];
  if (cmd) { cmd(); return true; }
  // エフェクト適用コマンド: effect.<effectId>
  if (id.startsWith('effect.')) {
    const effectId = id.slice(7);
    if (EFFECTS.find(e => e.id === effectId)) {
      if (!actions.applyEffectToSelected(effectId)) alert('レイヤーが選択されていません。');
      return true;
    }
  }
  return false;
}

// メニュー項目の有効/無効判定
export function isEnabled(id) {
  const comp = getComp();
  switch (id) {
    case 'edit.undo': return canUndo();
    case 'edit.redo': return canRedo();
    case 'edit.delete': case 'edit.duplicate': case 'edit.split':
    case 'layer.delete': case 'layer.duplicate': case 'layer.split':
    case 'layer.settings': case 'layer.resetTransform':
    case 'layer.orderTop': case 'layer.orderUp': case 'layer.orderDown': case 'layer.orderBottom':
    case 'layer.trimIn': case 'layer.trimOut':
      return state.selectedLayerIds.length > 0;
    case 'edit.selectAll': case 'layer.newText': case 'layer.newSolid':
    case 'comp.settings': case 'file.exportWebM':
      return !!comp;
    case 'anim.ease': case 'anim.linear': case 'anim.deleteKf':
      return state.selectedKeyframes.length > 0;
    default:
      if (id.startsWith('effect.')) return state.selectedLayerIds.length > 0;
      return true;
  }
}
