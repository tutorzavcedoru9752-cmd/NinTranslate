import {
  app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage,
  nativeTheme, screen, shell, Tray
} from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CapturePayload, CaptureSelection, HistoryEntry, ResultState, SettingsUpdate } from '../shared/types';
import { inferTranslationDirection } from '../shared/language';
import { recognizeImage, terminateOcr } from './ocr';
import {
  addHistory, clearHistory, deleteHistory, getPublicSettings, getTranslatorCredentials,
  listHistory, saveSettings
} from './storage';
import { translateText, type TranslatorCredentials } from './translator';
import { clampResultWindowSize } from './windowSize';

const preloadPath = path.join(__dirname, '..', 'preload', 'index.js');
const brandAssetPath = (filename: string): string => app.isPackaged
  ? path.join(process.resourcesPath, 'brand', filename)
  : path.join(app.getAppPath(), 'resources', 'brand', filename);
const overlayPayloads = new Map<number, CapturePayload>();
const overlayWindows = new Set<BrowserWindow>();
const resultStates = new Map<string, ResultState>();
const resultWindows = new Map<string, BrowserWindow>();
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function pageUrl(route: string): string {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) return `${dev}/#/${route}`;
  return `file://${path.join(app.getAppPath(), 'dist', 'index.html').replace(/\\/g, '/')}#/${route}`;
}

function createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  return new BrowserWindow({
    icon: brandAssetPath('nintranslate-window.png'),
    ...options,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !app.isPackaged,
      ...options.webPreferences
    }
  });
}

function closeOverlays(): void {
  for (const win of overlayWindows) if (!win.isDestroyed()) win.destroy();
  overlayWindows.clear();
  overlayPayloads.clear();
}

async function startCapture(): Promise<void> {
  closeOverlays();
  const displays = screen.getAllDisplays();
  const maxWidth = Math.max(...displays.map((d) => Math.ceil(d.size.width * d.scaleFactor)));
  const maxHeight = Math.max(...displays.map((d) => Math.ceil(d.size.height * d.scaleFactor)));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxWidth, height: maxHeight } });

  for (const display of displays) {
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[displays.indexOf(display)];
    if (!source) continue;
    const win = createWindow({
      x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
      frame: false, transparent: false, resizable: false, movable: false, skipTaskbar: true,
      alwaysOnTop: true, fullscreenable: false, show: false
    });
    overlayWindows.add(win);
    const webContentsId = win.webContents.id;
    overlayPayloads.set(webContentsId, {
      displayId: String(display.id), imageDataUrl: source.thumbnail.toDataURL(), bounds: display.bounds, scaleFactor: display.scaleFactor
    });
    win.on('closed', () => { overlayWindows.delete(win); overlayPayloads.delete(webContentsId); });
    await win.loadURL(pageUrl('overlay'));
    win.setAlwaysOnTop(true, 'screen-saver');
    win.show();
  }
}

function resultPosition(bounds: CaptureSelection['screenBounds']): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.workArea;
  const width = 440;
  const height = 430;
  let x = bounds.x + bounds.width + 12;
  if (x + width > area.x + area.width) x = Math.max(area.x, bounds.x - width - 12);
  let y = bounds.y;
  if (y + height > area.y + area.height) y = area.y + area.height - height;
  return { x: Math.max(area.x, x), y: Math.max(area.y, y) };
}

function sendResult(state: ResultState): void {
  resultStates.set(state.id, { ...state });
  const win = resultWindows.get(state.id);
  if (win && !win.isDestroyed()) win.webContents.send('result:update', state);
}

function broadcastHistory(history: HistoryEntry[] = listHistory()): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('history:changed', history);
  }
}

async function createResultWindow(selection: CaptureSelection): Promise<{ id: string; win: BrowserWindow }> {
  const id = randomUUID();
  const position = resultPosition(selection.screenBounds);
  const state: ResultState = {
    id, status: 'recognizing', sourceLanguage: 'en', targetLanguage: 'zh-Hans',
    sourceText: '', translatedText: '', message: '正在本地识别文字…', pinned: false
  };
  resultStates.set(id, state);
  const win = createWindow({
    ...position, width: 440, height: 430, minWidth: 360, minHeight: 320,
    frame: false, transparent: true, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    show: false, backgroundColor: '#00000000'
  });
  resultWindows.set(id, win);
  win.on('closed', () => { resultWindows.delete(id); resultStates.delete(id); });
  await win.loadURL(pageUrl(`result?id=${encodeURIComponent(id)}`));
  win.show();
  return { id, win };
}

async function performTranslation(id: string): Promise<void> {
  const state = resultStates.get(id);
  if (!state || !state.sourceText) return;
  let credentials: TranslatorCredentials;
  try { credentials = getTranslatorCredentials(); } catch (error) {
    sendResult({ ...state, status: 'needs-config', message: error instanceof Error ? error.message : '请检查翻译设置。' });
    return;
  }
  const hasCredentials = credentials.provider === 'baidu'
    ? Boolean(credentials.appId && credentials.secret)
    : Boolean(credentials.apiKey);
  if (!hasCredentials) {
    const serviceName = credentials.provider === 'baidu' ? '百度翻译 APP ID 和密钥' : '微软翻译 API 密钥';
    sendResult({ ...state, status: 'needs-config', message: `OCR 已完成。请先在设置中填写${serviceName}。` });
    return;
  }
  sendResult({ ...state, status: 'translating', translatedText: '', message: '正在翻译…' });
  try {
    const translatedText = await translateText(state.sourceText, state.sourceLanguage, state.targetLanguage, credentials);
    const ready: ResultState = { ...state, status: 'ready', translatedText, message: undefined };
    try {
      const history = addHistory({
        id, createdAt: new Date().toISOString(), sourceLanguage: ready.sourceLanguage,
        targetLanguage: ready.targetLanguage, sourceText: ready.sourceText, translatedText
      });
      broadcastHistory(history);
      sendResult(ready);
    } catch {
      sendResult({ ...ready, message: '翻译已完成，但历史记录保存失败，请检查应用数据目录权限。' });
    }
  } catch (error) {
    sendResult({ ...state, status: 'error', message: error instanceof Error ? error.message : '翻译失败，请重试。' });
  }
}

async function processSelection(selection: CaptureSelection): Promise<void> {
  closeOverlays();
  const { id } = await createResultWindow(selection);
  try {
    const ocr = await recognizeImage(selection.imageDataUrl);
    if (!ocr.text) {
      sendResult({ ...resultStates.get(id)!, status: 'empty', confidence: ocr.confidence, message: '没有识别到文字，请重新截图。' });
      return;
    }
    const direction = inferTranslationDirection(ocr.text);
    sendResult({
      ...resultStates.get(id)!, status: 'translating', sourceLanguage: direction.source, targetLanguage: direction.target,
      sourceText: ocr.text, confidence: ocr.confidence, message: ocr.confidence < 45 ? '识别置信度较低，翻译结果可能需要校对。' : '识别完成，正在翻译…'
    });
    await performTranslation(id);
  } catch (error) {
    sendResult({ ...resultStates.get(id)!, status: 'error', message: `文字识别失败：${error instanceof Error ? error.message : '未知错误'}` });
  }
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    broadcastHistory();
    return;
  }
  settingsWindow = createWindow({ width: 820, height: 680, minWidth: 700, minHeight: 560, frame: false, show: false, backgroundColor: '#f5f5f2' });
  settingsWindow.on('close', (event) => {
    if (!quitting) { event.preventDefault(); settingsWindow?.hide(); }
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
  void settingsWindow.loadURL(pageUrl('settings')).then(() => settingsWindow?.show());
}

function registerHotkey(accelerator: string): boolean {
  globalShortcut.unregisterAll();
  try { return globalShortcut.register(accelerator, () => void startCapture()); }
  catch { return false; }
}

function saveAndApplySettings(update: SettingsUpdate) {
  const old = getPublicSettings();
  if (!registerHotkey(update.hotkey)) {
    registerHotkey(old.hotkey);
    throw new Error(`快捷键“${update.hotkey}”无效或已被其他软件占用。`);
  }
  const saved = saveSettings(update);
  nativeTheme.themeSource = saved.theme;
  app.setLoginItemSettings({ openAtLogin: saved.launchAtLogin, path: process.execPath });
  return saved;
}

function createTray(): void {
  const icon = nativeImage.createFromPath(brandAssetPath('nintranslate-tray.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('NinTranslate 截图翻译');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '截图翻译', click: () => void startCapture() },
    { label: '设置与历史', click: openSettings },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => void startCapture());
}

function registerIpc(): void {
  ipcMain.handle('capture:get-payload', (event) => overlayPayloads.get(event.sender.id));
  ipcMain.handle('capture:complete', (_event, selection: CaptureSelection) => processSelection(selection));
  ipcMain.handle('capture:cancel', () => closeOverlays());
  ipcMain.handle('result:get', (_event, id: string) => resultStates.get(id) ?? null);
  ipcMain.handle('result:retry', (_event, id: string) => performTranslation(id));
  ipcMain.handle('result:swap', async (_event, id: string) => {
    const state = resultStates.get(id); if (!state) return;
    sendResult({ ...state, sourceLanguage: state.targetLanguage, targetLanguage: state.sourceLanguage, translatedText: '' });
    await performTranslation(id);
  });
  ipcMain.handle('result:copy', (_event, text: string) => clipboard.writeText(text));
  ipcMain.handle('result:pin', (_event, id: string, pinned: boolean) => {
    const state = resultStates.get(id); const win = resultWindows.get(id); if (!state || !win) return;
    win.setAlwaysOnTop(pinned, pinned ? 'screen-saver' : 'normal'); sendResult({ ...state, pinned });
  });
  ipcMain.handle('result:resize', (_event, id: string, width: number, height: number) => {
    const win = resultWindows.get(id);
    if (!win || win.isDestroyed()) return;
    const display = screen.getDisplayMatching(win.getBounds());
    const next = clampResultWindowSize(width, height, display.workAreaSize);
    win.setSize(next.width, next.height);
  });
  ipcMain.handle('result:close', (_event, id: string) => resultWindows.get(id)?.close());
  ipcMain.handle('settings:get', () => getPublicSettings());
  ipcMain.handle('settings:save', (_event, update: SettingsUpdate) => saveAndApplySettings(update));
  ipcMain.handle('settings:test', async (_event, update: SettingsUpdate) => {
    try {
      const stored = getTranslatorCredentials(update.provider);
      const credentials: TranslatorCredentials = update.provider === 'baidu'
        ? {
            provider: 'baidu',
            endpoint: update.endpoint,
            appId: update.baiduAppId?.trim() || (stored.provider === 'baidu' ? stored.appId : ''),
            secret: update.baiduSecret?.trim() || (stored.provider === 'baidu' ? stored.secret : '')
          }
        : {
            provider: 'microsoft',
            endpoint: update.endpoint,
            region: update.region,
            apiKey: update.apiKey?.trim() || (stored.provider === 'microsoft' ? stored.apiKey : '')
          };
      const translated = await translateText('Hello', 'en', 'zh-Hans', credentials);
      return { ok: true, message: `连接成功：Hello → ${translated}` };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '连接失败。' }; }
  });
  ipcMain.handle('history:list', () => listHistory());
  ipcMain.handle('history:delete', (_event, id: string) => {
    const history = deleteHistory(id);
    broadcastHistory(history);
    return history;
  });
  ipcMain.handle('history:clear', () => {
    const history = clearHistory();
    broadcastHistory(history);
    return history;
  });
  ipcMain.handle('app:start-capture', () => startCapture());
  ipcMain.handle('app:open-settings', () => openSettings());
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('app:open-external', (_event, url: string) => { if (url.startsWith('https://')) return shell.openExternal(url); });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => { if (argv.includes('--capture')) void startCapture(); else openSettings(); });
  app.whenReady().then(() => {
    registerIpc(); createTray();
    const settings = getPublicSettings(); nativeTheme.themeSource = settings.theme;
    if (!registerHotkey(settings.hotkey)) openSettings();
    if (process.argv.includes('--capture')) void startCapture();
    else if (!settings.hasCredentials) openSettings();
  });
  app.on('activate', openSettings);
  app.on('window-all-closed', () => { /* Keep tray process alive. */ });
  app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); void terminateOcr(); });
}
