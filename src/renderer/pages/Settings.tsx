import { useEffect, useMemo, useState } from 'react';
import { languageLabel, SUPPORTED_LANGUAGES } from '../../shared/language';
import { RECOGNITION_MODES } from '../../shared/recognition';
import type { HistoryEntry, LanguageCode, PublicSettings, RecognitionMode, SettingsUpdate, ThemeMode, TranslationProvider } from '../../shared/types';
import logoUrl from '../../../resources/brand/nintranslate-window.png';
import { runConnectionTest } from '../connectionTest';
import { Icon } from '../components/Icon';
import { Hotkey } from '../components/Hotkey';
import { version } from '../../../package.json';

const BAIDU_ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
const MICROSOFT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
const IS_MAC = navigator.userAgent.includes('Macintosh');
const initial: PublicSettings = {
  provider: 'baidu',
  endpoint: BAIDU_ENDPOINT,
  region: '',
  hotkey: IS_MAC ? 'CommandOrControl+Shift+T' : 'Alt+Shift+T',
  launchAtLogin: false,
  theme: 'system',
  defaultTargetLanguage: 'zh-Hans',
  recognitionMode: 'zh-en-fast',
  hasCredentials: false,
  hasBaiduCredentials: false,
  hasMicrosoftApiKey: false
};

export function Settings(): React.JSX.Element {
  const [tab, setTab] = useState<'settings' | 'history'>('settings');
  const [settings, setSettings] = useState<PublicSettings>(initial);
  const [baiduAppId, setBaiduAppId] = useState('');
  const [baiduSecret, setBaiduSecret] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [working, setWorking] = useState<'save' | 'test' | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    // The preload API is always present in Electron. Keeping the static view
    // renderable without it lets the design be checked safely in a browser.
    if (!window.ninTranslate) return undefined;
    const refreshHistory = (): void => { void window.ninTranslate.history.list().then(setHistory); };
    void Promise.all([window.ninTranslate.settings.get(), window.ninTranslate.history.list()]).then(([nextSettings, nextHistory]) => { setSettings(nextSettings); setHistory(nextHistory); });
    const stopHistoryUpdates = window.ninTranslate.history.onChanged(setHistory);
    window.addEventListener('focus', refreshHistory);
    return () => {
      stopHistoryUpdates();
      window.removeEventListener('focus', refreshHistory);
    };
  }, []);
  const filteredHistory = useMemo(() => { const needle = query.trim().toLowerCase(); return needle ? history.filter((item) => `${item.sourceText}\n${item.translatedText}`.toLowerCase().includes(needle)) : history; }, [history, query]);
  function update<K extends keyof PublicSettings>(key: K, value: PublicSettings[K]): void { setSettings((current) => ({ ...current, [key]: value })); setDirty(true); }
  function changeProvider(provider: TranslationProvider): void {
    setSettings((current) => ({
      ...current,
      provider,
      endpoint: provider === 'baidu' ? BAIDU_ENDPOINT : MICROSOFT_ENDPOINT,
      region: '',
      hasCredentials: provider === 'baidu' ? current.hasBaiduCredentials : current.hasMicrosoftApiKey
    }));
    setNotice(null);
    setDirty(true);
  }
  function payload(): SettingsUpdate {
    return {
      provider: settings.provider,
      endpoint: settings.endpoint,
      region: settings.region,
      hotkey: settings.hotkey,
      launchAtLogin: settings.launchAtLogin,
      theme: settings.theme,
      defaultTargetLanguage: settings.defaultTargetLanguage,
      recognitionMode: settings.recognitionMode,
      baiduAppId: baiduAppId || undefined,
      baiduSecret: baiduSecret || undefined,
      apiKey: apiKey || undefined
    };
  }
  async function save(): Promise<void> {
    setWorking('save');
    setNotice(null);
    try {
      const saved = await window.ninTranslate.settings.save(payload());
      setSettings(saved);
      setBaiduAppId('');
      setBaiduSecret('');
      setApiKey('');
      setDirty(false);
      setNotice({ kind: 'ok', text: '设置已安全保存。' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setWorking(null);
    }
  }
  async function testConnection(): Promise<void> {
    setWorking('test');
    setNotice(null);
    try {
      const result = await runConnectionTest(() => window.ninTranslate.settings.test(payload()));
      setNotice({ kind: result.ok ? 'ok' : 'error', text: result.message });
    } finally {
      setWorking(null);
    }
  }
  async function removeHistory(id: string): Promise<void> { setHistory(await window.ninTranslate.history.delete(id)); }
  async function refreshHistory(): Promise<void> { setHistory(await window.ninTranslate.history.list()); }
  async function clearAll(): Promise<void> {
    if (!history.length || !window.confirm(`确定清空全部 ${history.length} 条文字翻译历史吗？此操作无法撤销。`)) return;
    setHistory(await window.ninTranslate.history.clear());
  }

  return (
    <main className="settings-shell">
      <header className="titlebar drag-region">
        <div className="brand"><img className="brand-mark large" src={logoUrl} alt="" /><div><strong>NinTranslate</strong><small>让屏幕上的语言不再有距离</small></div></div>
        <div className="window-actions no-drag"><button className="icon-button" aria-label="最小化" title="最小化" onClick={() => void window.ninTranslate.app.minimize()}><Icon name="minimize" size={18} /></button><button className="icon-button window-close" aria-label="关闭到托盘" title="关闭到托盘" onClick={() => void window.ninTranslate.app.close()}><Icon name="close" size={18} /></button></div>
      </header>
      <div className="app-layout">
        <nav className="sidebar" aria-label="主导航">
          <span className="nav-caption">工作空间</span>
          <button className={tab === 'settings' ? 'nav-button active' : 'nav-button'} aria-label="设置" title="设置" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}><Icon name="settings" /><span>设置</span></button>
          <button className={tab === 'history' ? 'nav-button active' : 'nav-button'} aria-label="翻译历史" title="翻译历史" aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}><Icon name="history" /><span>翻译历史</span><em>{history.length}</em></button>
          <div className="sidebar-spacer" />
          <button className="capture-cta" aria-label="截图翻译" title="截图翻译" onClick={() => void window.ninTranslate.app.startCapture()}><Icon name="capture" size={22} /><span>截图翻译</span></button>
          <Hotkey value={settings.hotkey} />
          <div className="sidebar-bottom"><Icon name="shield" size={16} /><p>本地识别，图片不上传<small>NinTranslate · v{version}</small></p></div>
        </nav>
        {tab === 'settings' ? <section className="settings-main" aria-label="设置">
          <div className="page-scroll">
          <div className="page-heading"><div><h1>设置</h1><p>按你的习惯，让翻译更顺手。</p></div><span className={settings.hasCredentials ? 'connection-badge ready' : 'connection-badge'}><span className="status-dot" />{settings.hasCredentials ? '服务已配置' : '待配置服务'}</span></div>
          {notice && <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><Icon name={notice.kind === 'ok' ? 'check' : 'warning'} size={18} /><span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
          <div className="settings-card">
            <div className="card-heading"><div className="section-title"><span className="section-icon"><Icon name="language" /></span><div><h2>翻译服务</h2><p>只发送识别后的文字，不上传截图</p></div></div><span className="security-pill"><Icon name="shield" size={14} />{IS_MAC ? '钥匙串加密' : '系统加密'}</span></div>
            <fieldset disabled={working !== null}>
            <label>翻译服务<select value={settings.provider} onChange={(event) => changeProvider(event.target.value as TranslationProvider)}><option value="baidu">百度翻译（推荐）</option><option value="microsoft">Microsoft Translator</option></select></label>
            {settings.provider === 'baidu' ? <>
              <div className="two-columns"><label>APP ID<input value={baiduAppId} onChange={(event) => { setBaiduAppId(event.target.value); setDirty(true); }} placeholder={settings.hasBaiduCredentials ? '已保存，留空不修改' : '粘贴 APP ID'} autoComplete="off" spellCheck={false} /></label><label>密钥<input type="password" value={baiduSecret} onChange={(event) => { setBaiduSecret(event.target.value); setDirty(true); }} placeholder={settings.hasBaiduCredentials ? '已加密保存，留空不修改' : '粘贴百度翻译密钥'} autoComplete="off" /></label></div>
            </> : <>
              <div className="two-columns"><label>API 密钥<input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setDirty(true); }} placeholder={settings.hasMicrosoftApiKey ? '已加密保存，留空不修改' : '粘贴 Azure Translator 密钥'} autoComplete="off" /></label><label>服务区域<input value={settings.region} onChange={(event) => update('region', event.target.value)} placeholder="例如 eastasia，全局资源可留空" /></label></div>
            </>}
            <details className="advanced-settings"><summary><Icon name="chevron" size={14} />高级配置<span>通常无需修改</span></summary><label>服务端点<input type="url" value={settings.endpoint} onChange={(event) => update('endpoint', event.target.value)} spellCheck={false} /></label></details>
            </fieldset>
            <div className="card-actions"><button className="link-button" onClick={() => void window.ninTranslate.app.openExternal(settings.provider === 'baidu' ? 'https://fanyi-api.baidu.com/product/113' : 'https://learn.microsoft.com/azure/ai-services/translator/create-translator-resource')}>获取 API 凭据<Icon name="external" size={14} /></button><button className="secondary-button" disabled={working !== null} onClick={() => void testConnection()}>{working === 'test' ? <span className="spinner tiny" /> : <Icon name="refresh" size={16} />}{working === 'test' ? '正在测试…' : '测试连接'}</button></div>
          </div>
          <div className="settings-card preferences-card"><div className="card-heading"><div className="section-title"><span className="section-icon"><Icon name="spark" /></span><div><h2>翻译偏好</h2><p>应用于下一次截图，结果页仍可单独调整</p></div></div></div>
            <fieldset disabled={working !== null}>
              <div className="preference-row"><div><strong id="target-label">默认翻译成</strong><p>自动识别原文语言，翻译到你选择的语言</p></div><select aria-labelledby="target-label" value={settings.defaultTargetLanguage} onChange={(event) => update('defaultTargetLanguage', event.target.value as LanguageCode)}>{SUPPORTED_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></div>
              <div className="preference-row"><div><strong id="recognition-label">文字识别模式</strong><p>{RECOGNITION_MODES.find(({ code }) => code === settings.recognitionMode)?.description}</p></div><select aria-labelledby="recognition-label" value={settings.recognitionMode} onChange={(event) => update('recognitionMode', event.target.value as RecognitionMode)}>{RECOGNITION_MODES.map((mode) => <option key={mode.code} value={mode.code}>{mode.label}</option>)}</select></div>
            </fieldset>
          </div>
          <div className="settings-card preferences-card"><div className="card-heading"><div className="section-title"><span className="section-icon"><Icon name="settings" /></span><div><h2>通用设置</h2><p>快捷键、外观与启动方式</p></div></div></div>
            <fieldset disabled={working !== null}>
              <div className="preference-row"><div><strong id="hotkey-label">截图快捷键</strong><p>在其他应用上方快速框选文字</p></div><input aria-labelledby="hotkey-label" className="hotkey-input" value={settings.hotkey} onChange={(event) => update('hotkey', event.target.value)} spellCheck={false} /></div>
              <div className="preference-row"><div><strong id="theme-label">界面主题</strong><p>让明暗外观与工作环境保持一致</p></div><select aria-labelledby="theme-label" value={settings.theme} onChange={(event) => update('theme', event.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div>
              <div className="preference-row"><div><strong id="startup-label">开机自动启动</strong><p>登录后在{IS_MAC ? '菜单栏' : '系统托盘'}待命，不打扰工作</p></div><button className={settings.launchAtLogin ? 'switch on' : 'switch'} role="switch" aria-checked={settings.launchAtLogin} aria-labelledby="startup-label" onClick={() => update('launchAtLogin', !settings.launchAtLogin)}><span /></button></div>
            </fieldset>
          </div>
          <p className="settings-footnote"><Icon name="shield" size={15} />截图和识别都在本地完成，只有最终文字会发送给翻译服务。</p>
          </div>
          <div className="sticky-save"><span className={dirty ? 'unsaved' : ''}><span className="status-dot" />{dirty ? '有尚未保存的修改' : '修改后点击保存，下次截图生效'}</span><button className="primary-button" disabled={working !== null} onClick={() => void save()}>{working === 'save' ? <span className="spinner" /> : <Icon name="check" size={17} />}{working === 'save' ? '正在保存…' : '保存设置'}</button></div>
        </section> : <section className="settings-main history-page">
          <div className="page-scroll">
          <div className="page-heading"><div><h1>翻译历史</h1><p>留住有用的文字，随时找回灵感。</p></div><span className="connection-badge"><Icon name="shield" size={14} />仅本地保存</span></div>
          <div className="history-toolbar"><label className="search-field"><Icon name="search" size={18} /><input aria-label="搜索原文或译文" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索原文或译文" />{query && <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}</label><button className="icon-button bordered" aria-label="刷新历史" title="刷新历史" onClick={() => void refreshHistory()}><Icon name="refresh" size={18} /></button><button className="danger-button" disabled={!history.length} onClick={() => void clearAll()}><Icon name="trash" size={16} />清空记录</button></div>
          <div className="history-summary"><span>{query ? `找到 ${filteredHistory.length} 条匹配记录` : `共 ${history.length} 条记录`}</span><span>最多保留最近 500 条 · 不保存图片</span></div>
          <div className="history-list">{filteredHistory.length === 0 ? <div className="empty-history"><span className="empty-icon"><Icon name={history.length ? 'search' : 'history'} size={32} /></span><h2>{history.length ? '没有找到匹配记录' : '你的翻译，从这里开始'}</h2><p>{history.length ? '试试其他关键词，或清除搜索查看全部。' : '完成一次截图翻译后，原文和译文会保存在这里。'}</p>{history.length ? <button className="secondary-button" onClick={() => setQuery('')}>查看全部记录</button> : <button className="primary-button" onClick={() => void window.ninTranslate.app.startCapture()}><Icon name="capture" size={18} />开始截图翻译</button>}</div> : filteredHistory.map((entry) => <article className="history-item" key={entry.id}><div className="history-meta"><span className="history-direction">{languageLabel(entry.sourceLanguage)}<Icon name="arrow" size={14} />{languageLabel(entry.targetLanguage)}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><button className="icon-button delete-history" aria-label="删除这条记录" title="删除这条记录" onClick={() => void removeHistory(entry.id)}><Icon name="trash" size={16} /></button></div><div className="history-columns"><div><div className="history-text-label"><small>原文</small><button className="text-button" aria-label="复制历史原文" onClick={() => void window.ninTranslate.result.copy(entry.sourceText)}><Icon name="copy" size={14} />复制</button></div><p>{entry.sourceText}</p></div><div><div className="history-text-label"><small>译文</small><button className="text-button" aria-label="复制历史译文" onClick={() => void window.ninTranslate.result.copy(entry.translatedText)}><Icon name="copy" size={14} />复制</button></div><p>{entry.translatedText}</p></div></div></article>)}</div>
          </div>
        </section>}
      </div>
    </main>
  );
}
