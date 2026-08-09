import { useEffect, useState } from 'react';
import { languageLabel, SUPPORTED_LANGUAGES } from '../../shared/language';
import { recognitionModeLabel } from '../../shared/recognition';
import type { LanguageCode, ResultState, TextFlowMode } from '../../shared/types';
import logoUrl from '../../../resources/brand/nintranslate-window.png';

function resultId(): string { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('id') || ''; }

export function Result(): React.JSX.Element {
  const id = resultId();
  const [state, setState] = useState<ResultState | null>(null);
  const [copied, setCopied] = useState<'source' | 'translation' | null>(null);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftSource, setDraftSource] = useState('');
  const [editError, setEditError] = useState('');

  useEffect(() => {
    void window.ninTranslate.result.get(id).then(setState);
    return window.ninTranslate.result.onUpdate((next) => { if (next.id === id) setState(next); });
  }, [id]);

  function copy(text: string, kind: 'source' | 'translation'): void {
    void window.ninTranslate.result.copy(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
  }

  function changeTarget(targetLanguage: LanguageCode): void {
    if (!state || targetLanguage === state.targetLanguage) return;
    void window.ninTranslate.result.setTarget(id, targetLanguage);
  }

  function changeFlowMode(flowMode: TextFlowMode): void {
    if (!state || flowMode === state.flowMode) return;
    void window.ninTranslate.result.setFlowMode(id, flowMode);
  }

  function beginEdit(): void {
    if (!state) return;
    setDraftSource(state.sourceText);
    setEditError('');
    setEditing(true);
  }

  function cancelEdit(): void {
    setDraftSource('');
    setEditError('');
    setEditing(false);
  }

  async function saveEdit(): Promise<void> {
    const normalized = draftSource.replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      setEditError('原文不能为空。');
      return;
    }
    try {
      await window.ninTranslate.result.updateSource(id, normalized);
      setEditing(false);
      setEditError('');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存原文失败，请重试。');
    }
  }

  if (!state) return <main className="result-shell loading"><span className="spinner dark" />正在打开…</main>;
  const busy = state.status === 'recognizing' || state.status === 'translating';

  return (
    <main className="result-shell">
      <header className="result-header drag-region">
        <img className="brand-mark" src={logoUrl} alt="" />
        <div><strong>NinTranslate</strong><span>{busy ? state.message : `${languageLabel(state.sourceLanguage)} → ${languageLabel(state.targetLanguage)}`}</span></div>
        <div className="window-actions no-drag">
          <button className={state.pinned ? 'icon-button active' : 'icon-button'} title="固定在最上方" onClick={() => void window.ninTranslate.result.pin(id, !state.pinned)}>⌖</button>
          <button className={showSizeMenu ? 'icon-button active' : 'icon-button'} aria-label="调整窗口大小" aria-expanded={showSizeMenu} title="调整窗口大小" onClick={() => setShowSizeMenu((visible) => !visible)}>⤢</button>
          <button className="icon-button" title="关闭" onClick={() => void window.ninTranslate.result.close(id)}>×</button>
        </div>
      </header>
      {showSizeMenu && <div className="size-menu no-drag" role="menu" aria-label="窗口大小">
        <button role="menuitem" onClick={() => { void window.ninTranslate.result.resize(id, 380, 340); setShowSizeMenu(false); }}><strong>紧凑</strong><span>380 × 340</span></button>
        <button role="menuitem" onClick={() => { void window.ninTranslate.result.resize(id, 440, 430); setShowSizeMenu(false); }}><strong>标准</strong><span>440 × 430</span></button>
        <button role="menuitem" onClick={() => { void window.ninTranslate.result.resize(id, 640, 560); setShowSizeMenu(false); }}><strong>宽大</strong><span>640 × 560</span></button>
      </div>}
      <section className="result-content">
        {busy && !state.sourceText && <div className="center-state"><span className="spinner dark" /><strong>{state.message}</strong><span>截图只在本机内存中处理</span></div>}
        {state.sourceText && <>
          <div className="text-panel source-panel">
            <div className="panel-label"><label className="flow-mode"><span>原文 · <strong className="detected-language">{state.sourceLanguage === 'auto' ? (busy ? '识别中' : '自动识别') : languageLabel(state.sourceLanguage)}</strong></span><select aria-label="原文分段方式" value={state.flowMode} disabled={busy || editing || state.sourceEdited} onChange={(event) => changeFlowMode(event.target.value as TextFlowMode)}><option value="smart">智能分段</option><option value="preserve">保留视觉行</option><option value="merge">合并为一段</option></select></label><div className="panel-actions">{editing ? <><button onClick={cancelEdit}>取消</button><button className="save-source" onClick={() => void saveEdit()}>保存并重译</button></> : <><button disabled={busy} onClick={beginEdit}>编辑原文</button><button onClick={() => copy(state.sourceText, 'source')}>{copied === 'source' ? '已复制' : '复制'}</button></>}</div></div>
            {editing ? <div className="source-editor-wrap"><textarea className="source-editor" aria-label="编辑识别原文" autoFocus value={draftSource} onChange={(event) => { setDraftSource(event.target.value); setEditError(''); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveEdit(); } }} />{editError && <span className="source-edit-error" role="alert">{editError}</span>}</div> : <div className="text-scroll">{state.sourceText}</div>}
          </div>
          <button className="swap-button" title="交换原文和译文" onClick={() => void window.ninTranslate.result.swap(id)} disabled={busy || editing || state.sourceLanguage === 'auto' || !state.translatedText}>⇅</button>
          <div className="text-panel translation-panel">
            <div className="panel-label"><label className="target-language"><span>译文 ·</span><select aria-label="目标语言" value={state.targetLanguage} disabled={!state.sourceText || editing} onChange={(event) => changeTarget(event.target.value as LanguageCode)}>{SUPPORTED_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label>{state.translatedText && <button onClick={() => copy(state.translatedText, 'translation')}>{copied === 'translation' ? '已复制' : '复制'}</button>}</div>
            <div className="text-scroll translation-text">{state.translatedText || (busy ? <span className="inline-loading"><span className="spinner tiny" />正在翻译…</span> : <span className="placeholder">等待翻译结果</span>)}</div>
          </div>
        </>}
        {!busy && state.message && <div className={`status-banner ${state.status}`}><span>{state.status === 'empty' ? '未找到文字' : state.status === 'needs-config' ? '需要配置' : '提示'}</span><p>{state.message}</p></div>}
      </section>
      <footer className="result-footer">
        <span>{state.sourceEdited ? '原文已人工编辑' : state.confidence !== undefined ? `${recognitionModeLabel(state.recognitionMode)} · OCR 置信度 ${Math.round(state.confidence)}%` : `${recognitionModeLabel(state.recognitionMode)} · 图片不上传`}<small>{editing ? 'Enter 换段 · Ctrl/Command + Enter 保存' : '使用顶部尺寸按钮调整窗口大小'}</small></span>
        <div>
          {state.status === 'needs-config' && <button className="secondary-button" onClick={() => void window.ninTranslate.app.openSettings()}>打开设置</button>}
          {(state.status === 'error' || state.status === 'needs-config') && state.sourceText && <button className="primary-button small" onClick={() => void window.ninTranslate.result.retry(id)}>重试翻译</button>}
          {state.status === 'empty' && <button className="primary-button small" onClick={() => { void window.ninTranslate.result.close(id); void window.ninTranslate.app.startCapture(); }}>重新截图</button>}
        </div>
      </footer>
    </main>
  );
}
