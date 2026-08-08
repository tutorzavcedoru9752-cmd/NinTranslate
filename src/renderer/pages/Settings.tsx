import { useEffect, useMemo, useState } from 'react';
import { languageLabel, SUPPORTED_LANGUAGES } from '../../shared/language';
import type { HistoryEntry, LanguageCode, PublicSettings, SettingsUpdate, ThemeMode, TranslationProvider } from '../../shared/types';
import logoUrl from '../../../resources/brand/nintranslate-window.png';
import { runConnectionTest } from '../connectionTest';

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
  const [working, setWorking] = useState(false);

  useEffect(() => {
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
  function update<K extends keyof PublicSettings>(key: K, value: PublicSettings[K]): void { setSettings((current) => ({ ...current, [key]: value })); }
  function changeProvider(provider: TranslationProvider): void {
    setSettings((current) => ({
      ...current,
      provider,
      endpoint: provider === 'baidu' ? BAIDU_ENDPOINT : MICROSOFT_ENDPOINT,
      region: '',
      hasCredentials: provider === 'baidu' ? current.hasBaiduCredentials : current.hasMicrosoftApiKey
    }));
    setNotice(null);
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
      baiduAppId: baiduAppId || undefined,
      baiduSecret: baiduSecret || undefined,
      apiKey: apiKey || undefined
    };
  }
  async function save(): Promise<void> {
    setWorking(true);
    setNotice(null);
    try {
      const saved = await window.ninTranslate.settings.save(payload());
      setSettings(saved);
      setBaiduAppId('');
      setBaiduSecret('');
      setApiKey('');
      setNotice({ kind: 'ok', text: '设置已安全保存。' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setWorking(false);
    }
  }
  async function testConnection(): Promise<void> {
    setWorking(true);
    setNotice(null);
    try {
      const result = await runConnectionTest(() => window.ninTranslate.settings.test(payload()));
      setNotice({ kind: result.ok ? 'ok' : 'error', text: result.message });
    } finally {
      setWorking(false);
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
      <header className="titlebar drag-region"><div className="brand"><img className="brand-mark large" src={logoUrl} alt="" /><div><strong>NinTranslate</strong><small>截图即翻译</small></div></div><div className="window-actions no-drag"><button className="icon-button" onClick={() => void window.ninTranslate.app.minimize()}>−</button><button className="icon-button" onClick={() => void window.ninTranslate.app.close()}>×</button></div></header>
      <div className="app-layout">
        <nav className="sidebar">
          <button className={tab === 'settings' ? 'nav-button active' : 'nav-button'} onClick={() => setTab('settings')}><span>⚙</span>设置</button>
          <button className={tab === 'history' ? 'nav-button active' : 'nav-button'} onClick={() => setTab('history')}><span>◷</span>翻译历史<em>{history.length}</em></button>
          <div className="sidebar-spacer" />
          <button className="capture-cta" onClick={() => void window.ninTranslate.app.startCapture()}><span>⌗</span><div><strong>开始截图</strong><small>{settings.hotkey}</small></div></button>
          <p className="privacy-note">截图在本地识别<br />图片不会上传或保存</p>
        </nav>
        {tab === 'settings' ? <section className="settings-main">
          <div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>设置</h1><p>配置翻译服务和使用习惯</p></div><span className={settings.hasCredentials ? 'connection-badge ready' : 'connection-badge'}>{settings.hasCredentials ? '服务已配置' : '等待配置'}</span></div>
          {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
          <div className="settings-card">
            <div className="card-heading"><div><h2>{settings.provider === 'baidu' ? '百度翻译服务' : '微软翻译服务'}</h2><p>截图不会上传，仅发送 OCR 识别出的文字</p></div><span className="security-pill">{IS_MAC ? '钥匙串加密' : 'Windows 加密'}</span></div>
            <label>翻译服务<select value={settings.provider} onChange={(event) => changeProvider(event.target.value as TranslationProvider)}><option value="baidu">百度翻译（推荐）</option><option value="microsoft">Microsoft Translator</option></select></label>
            {settings.provider === 'baidu' ? <>
              <div className="two-columns"><label>APP ID<input value={baiduAppId} onChange={(event) => setBaiduAppId(event.target.value)} placeholder={settings.hasBaiduCredentials ? '已安全保存；留空表示不修改' : '粘贴百度翻译 APP ID'} autoComplete="off" /></label><label>密钥<input type="password" value={baiduSecret} onChange={(event) => setBaiduSecret(event.target.value)} placeholder={settings.hasBaiduCredentials ? '已安全保存；留空表示不修改' : '粘贴百度翻译密钥'} autoComplete="off" /></label></div>
              <label>服务端点<input value={settings.endpoint} onChange={(event) => update('endpoint', event.target.value)} /></label>
            </> : <>
              <label>API 密钥<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasMicrosoftApiKey ? '已安全保存；留空表示不修改' : '粘贴 Azure Translator 密钥'} autoComplete="off" /></label>
              <div className="two-columns"><label>服务区域<input value={settings.region} onChange={(event) => update('region', event.target.value)} placeholder="例如：eastasia（全局资源可留空）" /></label><label>服务端点<input value={settings.endpoint} onChange={(event) => update('endpoint', event.target.value)} /></label></div>
            </>}
            <div className="card-actions"><button className="link-button" onClick={() => void window.ninTranslate.app.openExternal(settings.provider === 'baidu' ? 'https://fanyi-api.baidu.com/product/113' : 'https://learn.microsoft.com/azure/ai-services/translator/create-translator-resource')}>如何获取凭据 ↗</button><button className="secondary-button" disabled={working} onClick={() => void testConnection()}>测试连接</button></div>
          </div>
          <div className="settings-card compact"><h2>使用偏好</h2><div className="preference-row"><div><strong>默认翻译成</strong><p>新截图完成识别后自动翻译到该语言</p></div><select value={settings.defaultTargetLanguage} onChange={(event) => update('defaultTargetLanguage', event.target.value as LanguageCode)}>{SUPPORTED_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></div><div className="preference-row"><div><strong>截图快捷键</strong><p>从任意应用中唤起区域截图</p></div><input className="hotkey-input" value={settings.hotkey} onChange={(event) => update('hotkey', event.target.value)} /></div><div className="preference-row"><div><strong>界面主题</strong><p>跟随系统或固定明暗外观</p></div><select value={settings.theme} onChange={(event) => update('theme', event.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div><div className="preference-row"><div><strong>开机自动启动</strong><p>登录系统后在{IS_MAC ? '菜单栏' : '托盘'}中运行</p></div><button className={settings.launchAtLogin ? 'switch on' : 'switch'} role="switch" aria-checked={settings.launchAtLogin} onClick={() => update('launchAtLogin', !settings.launchAtLogin)}><span /></button></div></div>
          <div className="sticky-save"><span>{settings.hasCredentials ? `凭据已使用${IS_MAC ? '系统钥匙串' : 'Windows 用户级'}加密` : '首次使用前请填写翻译服务凭据'}</span><button className="primary-button" disabled={working} onClick={() => void save()}>{working ? '处理中…' : '保存设置'}</button></div>
        </section> : <section className="settings-main history-page">
          <div className="page-heading"><div><p className="eyebrow">LOCAL HISTORY</p><h1>翻译历史</h1><p>仅保存在这台电脑上的文字记录</p></div></div>
          <div className="history-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索原文或译文…" /><span>{filteredHistory.length} 条记录</span><button className="secondary-button compact-button" onClick={() => void refreshHistory()}>刷新</button><button className="danger-button" disabled={!history.length} onClick={() => void clearAll()}>清空记录</button></div>
          <div className="history-list">{filteredHistory.length === 0 ? <div className="empty-history"><span>◫</span><h2>{history.length ? '没有匹配的结果' : '还没有翻译记录'}</h2><p>{history.length ? '换一个关键词试试' : '完成一次截图翻译后，文字记录会出现在这里'}</p><button className="primary-button" onClick={() => void window.ninTranslate.app.startCapture()}>开始截图翻译</button></div> : filteredHistory.map((entry) => <article className="history-item" key={entry.id}><div className="history-meta"><span>{languageLabel(entry.sourceLanguage)} → {languageLabel(entry.targetLanguage)}</span><time>{new Date(entry.createdAt).toLocaleString('zh-CN')}</time><button title="删除" onClick={() => void removeHistory(entry.id)}>×</button></div><div className="history-columns"><div><small>原文</small><p>{entry.sourceText}</p><button onClick={() => void window.ninTranslate.result.copy(entry.sourceText)}>复制</button></div><div><small>译文</small><p>{entry.translatedText}</p><button onClick={() => void window.ninTranslate.result.copy(entry.translatedText)}>复制</button></div></div></article>)}</div>
        </section>}
      </div>
    </main>
  );
}
