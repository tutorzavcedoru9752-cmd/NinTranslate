import { useEffect, useState } from 'react';
import { languageLabel } from '../../shared/language';
import type { ResultState } from '../../shared/types';
import logoUrl from '../../../resources/brand/nintranslate-window.png';

function resultId(): string { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('id') || ''; }

export function Result(): React.JSX.Element {
  const id = resultId();
  const [state, setState] = useState<ResultState | null>(null);
  const [copied, setCopied] = useState<'source' | 'translation' | null>(null);
  const [showSizeMenu, setShowSizeMenu] = useState(false);

  useEffect(() => {
    void window.ninTranslate.result.get(id).then(setState);
    return window.ninTranslate.result.onUpdate((next) => { if (next.id === id) setState(next); });
  }, [id]);

  function copy(text: string, kind: 'source' | 'translation'): void {
    void window.ninTranslate.result.copy(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
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
            <div className="panel-label"><span>原文 · {languageLabel(state.sourceLanguage)}</span><button onClick={() => copy(state.sourceText, 'source')}>{copied === 'source' ? '已复制' : '复制'}</button></div>
            <div className="text-scroll">{state.sourceText}</div>
          </div>
          <button className="swap-button" title="交换翻译方向" onClick={() => void window.ninTranslate.result.swap(id)} disabled={busy}>⇅</button>
          <div className="text-panel translation-panel">
            <div className="panel-label"><span>译文 · {languageLabel(state.targetLanguage)}</span>{state.translatedText && <button onClick={() => copy(state.translatedText, 'translation')}>{copied === 'translation' ? '已复制' : '复制'}</button>}</div>
            <div className="text-scroll translation-text">{state.translatedText || (busy ? <span className="inline-loading"><span className="spinner tiny" />正在翻译…</span> : <span className="placeholder">等待翻译结果</span>)}</div>
          </div>
        </>}
        {!busy && state.message && <div className={`status-banner ${state.status}`}><span>{state.status === 'empty' ? '未找到文字' : state.status === 'needs-config' ? '需要配置' : '提示'}</span><p>{state.message}</p></div>}
      </section>
      <footer className="result-footer">
        <span>{state.confidence !== undefined ? `OCR 置信度 ${Math.round(state.confidence)}%` : '本地 OCR · 图片不上传'}<small>使用顶部尺寸按钮调整窗口大小</small></span>
        <div>
          {state.status === 'needs-config' && <button className="secondary-button" onClick={() => void window.ninTranslate.app.openSettings()}>打开设置</button>}
          {(state.status === 'error' || state.status === 'needs-config') && state.sourceText && <button className="primary-button small" onClick={() => void window.ninTranslate.result.retry(id)}>重试翻译</button>}
          {state.status === 'empty' && <button className="primary-button small" onClick={() => { void window.ninTranslate.result.close(id); void window.ninTranslate.app.startCapture(); }}>重新截图</button>}
        </div>
      </footer>
    </main>
  );
}
