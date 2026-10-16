import { useEffect, useRef, useState } from 'react';
import { languageLabel, SUPPORTED_LANGUAGES } from '../../shared/language';
import { recognitionModeLabel } from '../../shared/recognition';
import type { LanguageCode, ResultState, TextFlowMode } from '../../shared/types';
import logoUrl from '../../../resources/brand/nintranslate-window.png';
import { Icon } from '../components/Icon';

function resultId(): string { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('id') || ''; }

export function Result(): React.JSX.Element {
  const id = resultId();
  const [state, setState] = useState<ResultState | null>(null);
  const [copied, setCopied] = useState<'source' | 'translation' | null>(null);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftSource, setDraftSource] = useState('');
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const sizeMenuRef = useRef<HTMLDivElement>(null);
  const sizeButtonRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);
  useEffect(() => {
    if (!showSizeMenu) return;
    const dismiss = (event: PointerEvent): void => {
      if (!sizeMenuRef.current?.contains(event.target as Node) && !sizeButtonRef.current?.contains(event.target as Node)) setShowSizeMenu(false);
    };
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setShowSizeMenu(false); sizeButtonRef.current?.focus(); } };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', escape);
    sizeMenuRef.current?.querySelector('button')?.focus();
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); };
  }, [showSizeMenu]);

  useEffect(() => {
    void window.ninTranslate.result.get(id).then(setState);
    return window.ninTranslate.result.onUpdate((next) => { if (next.id === id) setState(next); });
  }, [id]);

  function copy(text: string, kind: 'source' | 'translation'): void {
    void window.ninTranslate.result.copy(text);
    setCopied(kind);
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(null), 1600);
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
    if (savingEdit) return;
    const normalized = draftSource.replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      setEditError('原文不能为空。');
      return;
    }
    try {
      setSavingEdit(true);
      await window.ninTranslate.result.updateSource(id, normalized);
      setEditing(false);
      setEditError('');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存原文失败，请重试。');
    } finally {
      setSavingEdit(false);
    }
  }

  if (!state) return <main className="result-shell loading"><span className="spinner dark" />正在打开…</main>;
  const busy = state.status === 'recognizing' || state.status === 'translating';

  return (
    <main className="result-shell">
      <header className="result-header drag-region">
        <img className="brand-mark" src={logoUrl} alt="" />
        <div className="result-brand-text"><strong>NinTranslate</strong><span>{busy ? state.message : `${languageLabel(state.sourceLanguage)} → ${languageLabel(state.targetLanguage)}`}</span></div>
        <div className="window-actions no-drag">
          <button className={state.pinned ? 'icon-button active' : 'icon-button'} aria-pressed={state.pinned} aria-label="固定在最上方" title={state.pinned ? '取消固定' : '固定在最上方'} onClick={() => void window.ninTranslate.result.pin(id, !state.pinned)}><Icon name="pin" size={18} /></button>
          <button ref={sizeButtonRef} className={showSizeMenu ? 'icon-button active' : 'icon-button'} aria-label="调整窗口大小" aria-expanded={showSizeMenu} aria-controls="size-options" title="调整窗口大小" onClick={() => setShowSizeMenu((visible) => !visible)}><Icon name="resize" size={18} /></button>
          <button className="icon-button window-close" aria-label="关闭翻译结果" title="关闭" onClick={() => void window.ninTranslate.result.close(id)}><Icon name="close" size={18} /></button>
        </div>
      </header>
      {showSizeMenu && <div ref={sizeMenuRef} id="size-options" className="size-menu no-drag" role="group" aria-label="窗口大小">
        <p>窗口大小<span>也可拖动窗口边缘</span></p>
        {([{ label: '紧凑', width: 400, height: 440 }, { label: '标准', width: 520, height: 580 }, { label: '宽大', width: 720, height: 640 }]).map((size) => <button key={size.label} onClick={() => { void window.ninTranslate.result.resize(id, size.width, size.height); setShowSizeMenu(false); sizeButtonRef.current?.focus(); }}><strong>{size.label}</strong><span>{size.width} × {size.height}</span></button>)}
      </div>}
      <section className="result-content">
        {busy && !state.sourceText && <div className="center-state" role="status"><span className="loading-orbit"><Icon name="capture" size={30} /></span><strong>{state.message}</strong><span>正在读懂你框选的内容</span><small><Icon name="shield" size={14} />截图只在本机内存中处理</small><span className="spinner dark" /></div>}
        {state.sourceText && <>
          <div className="text-panel source-panel">
            <div className="panel-label"><span className="panel-title">原文<strong className="detected-language">{state.sourceLanguage === 'auto' ? (busy ? '识别中' : '自动识别') : languageLabel(state.sourceLanguage)}</strong></span><div className="panel-actions">{editing ? <><button className="text-button" disabled={savingEdit} onClick={cancelEdit}>取消</button><button className="save-source" disabled={savingEdit || !draftSource.trim()} onClick={() => void saveEdit()}><Icon name="check" size={14} />{savingEdit ? '正在保存' : '保存并重译'}</button></> : <><button className="text-button edit-source-button" disabled={busy} onClick={beginEdit} aria-label="编辑原文" title="编辑原文"><Icon name="edit" size={15} /><span>编辑</span></button><button className="text-button" aria-label="复制原文" title={copied === 'source' ? '已复制原文' : '复制原文'} onClick={() => copy(state.sourceText, 'source')}><Icon name={copied === 'source' ? 'check' : 'copy'} size={15} /><span className="copy-label">{copied === 'source' ? '已复制' : '复制'}</span></button></>}</div></div>
            {!editing && <div className="source-tools"><label className="flow-mode"><select aria-label="原文分段方式" value={state.flowMode} disabled={busy || state.sourceEdited} onChange={(event) => changeFlowMode(event.target.value as TextFlowMode)}><option value="smart">智能分段</option><option value="preserve">保留视觉行</option><option value="merge">合并为一段</option></select></label><span>{state.sourceEdited ? '已手动校对' : '识别有误？可编辑原文'}</span></div>}
            {editing ? <div className="source-editor-wrap"><textarea className="source-editor" aria-label="编辑识别原文" aria-invalid={Boolean(editError)} aria-describedby={editError ? 'source-edit-error' : 'edit-hint'} disabled={savingEdit} autoFocus value={draftSource} onChange={(event) => { setDraftSource(event.target.value); setEditError(''); }} onKeyDown={(event) => { if (savingEdit || event.nativeEvent.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveEdit(); } }} />{editError && <span id="source-edit-error" className="source-edit-error" role="alert">{editError}</span>}</div> : <div className="text-scroll" tabIndex={0} aria-label="识别原文">{state.sourceText}</div>}
          </div>
          <div className="result-divider"><span /><button className="swap-button" aria-label="交换原文和译文" title="交换原文和译文" onClick={() => void window.ninTranslate.result.swap(id)} disabled={busy || editing || state.sourceLanguage === 'auto' || !state.translatedText}><Icon name="swap" size={16} /></button><span /></div>
          <div className="text-panel translation-panel">
            <div className="panel-label"><label className="target-language"><span>译文</span><select aria-label="目标语言" value={state.targetLanguage} disabled={!state.sourceText || editing} onChange={(event) => changeTarget(event.target.value as LanguageCode)}>{SUPPORTED_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label><div className="panel-actions">{busy && <span className="spinner tiny" aria-label="正在翻译" />}{state.translatedText && <button className="text-button" aria-label="复制译文" title={copied === 'translation' ? '已复制译文' : '复制译文'} onClick={() => copy(state.translatedText, 'translation')}><Icon name={copied === 'translation' ? 'check' : 'copy'} size={15} /><span className="copy-label">{copied === 'translation' ? '已复制' : '复制'}</span></button>}</div></div>
            <div className="text-scroll translation-text" tabIndex={0} aria-label="翻译结果" aria-busy={state.status === 'translating'}>{state.translatedText || (busy ? <span className="inline-loading"><span className="spinner tiny" />正在翻译…</span> : <span className="placeholder">译文将显示在这里</span>)}</div>
          </div>
        </>}
        {!busy && !state.sourceText && <div className="center-state"><span className="empty-icon"><Icon name={state.status === 'empty' ? 'capture' : 'warning'} size={30} /></span><strong>{state.status === 'empty' ? '没有识别到文字' : state.status === 'needs-config' ? '先连接你的翻译服务' : '这次识别未能完成'}</strong><span>你可以重新截图，或检查服务配置。</span></div>}
        {!busy && state.message && <div className={`status-banner ${state.status}`} role={state.status === 'error' ? 'alert' : 'status'}><Icon name={state.status === 'error' || state.status === 'needs-config' ? 'warning' : 'info'} size={17} /><p>{state.message}</p></div>}
      </section>
      <footer className="result-footer">
        <span className="result-footnote" id="edit-hint"><Icon name={editing ? 'keyboard' : 'shield'} size={15} /><span>{editing ? 'Enter 换段 · Ctrl/⌘ + Enter 保存 · Esc 取消' : state.sourceEdited ? '已手动校对 · 图片不上传' : `${recognitionModeLabel(state.recognitionMode)} · 图片不上传`}</span></span>
        <span className="copy-announcement" role="status">{copied ? '文字已复制到剪贴板' : ''}</span>
        <div>
          {state.status === 'needs-config' && <button className="secondary-button" onClick={() => void window.ninTranslate.app.openSettings()}>打开设置</button>}
          {(state.status === 'error' || state.status === 'needs-config') && state.sourceText && <button className="primary-button small" onClick={() => void window.ninTranslate.result.retry(id)}>重试翻译</button>}
          {state.status === 'empty' && <button className="primary-button small" onClick={() => { void window.ninTranslate.result.close(id); void window.ninTranslate.app.startCapture(); }}>重新截图</button>}
        </div>
      </footer>
    </main>
  );
}
