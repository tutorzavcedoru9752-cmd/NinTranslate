import {
  app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage,
  nativeTheme, screen, shell, systemPreferences, Tray
} from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CapturePayload, CaptureSelection, HistoryEntry, LanguageCode, ResultState, SettingsUpdate, TextFlowMode } from '../shared/types';
import { isLanguageCode } from '../shared/language';
import { recognizeImage, terminateOcr, type OcrParagraph } from './ocr';
import { buildTranslationText } from './textFlow';
import {
  addHistory, clearHistory, deleteHistory, getPublicSettings, getTranslatorCredentials,
  listHistory, saveSettings
} from './storage';
import { translateText, type TranslatorCredentials } from './translator';
import { clampResultWindowSize } from './windowSize';
import { testTranslatorConnection } from './connectionTest';
import { RequestVersionTracker } from './requestVersion';
import { prepareEditedResult } from './sourceEdit';

const preloadPath = path.join(__dirname, '..', 'preload', 'index.js');
const brandAssetPath = (filename: string): string => app.isPackaged
  ? path.join(process.resourcesPath, 'brand', filename)
  : path.join(app.getAppPath(), 'resources', 'brand', filename);
const overlayPayloads = new Map<number, CapturePayload>();
const overlayWindows = new Set<BrowserWindow>();
const resultStates = new Map<string, ResultState>();
const resultOcrParagraphs = new Map<string, OcrParagraph[]>();
const resultWindows = new Map<string, BrowserWindow>();
const resultRequestVersions = new RequestVersionTracker();
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

async function ensureScreenCapturePermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status !== 'denied' && status !== 'restricted') return true;
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: '需要屏幕录制权限',
    message: 'NinTranslate 需要读取屏幕画面，才能让你框选并识别文字。',
    detail: '请在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许 NinTranslate，然后重新启动应用。',
    buttons: ['打开系统设置', '暂不设置'],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  return false;
}

async function startCapture(): Promise<void> {
  if (!await ensureScreenCapturePermission()) return;
  closeOverlays();
  const displays = screen.getAllDisplays();
  const maxWidth = Math.max(...displays.map((d) => Math.ceil(d.size.width * d.scaleFactor)));
  const maxHeight = Math.max(...displays.map((d) => Math.ceil(d.size.height * d.scaleFactor)));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxWidth, height: maxHeight } });
  if (!sources.length) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '无法读取屏幕',
      message: '没有取得可用的屏幕画面。',
      detail: process.platform === 'darwin'
        ? '请确认已在“系统设置 → 隐私与安全性”中授予屏幕录制权限，然后重新启动 NinTranslate。'
        : '请重试；如果问题持续存在，请重新启动 NinTranslate。',
      buttons: ['知道了']
    });
    return;
  }

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
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
  const settings = getPublicSettings();
  const state: ResultState = {
    id, status: 'recognizing', sourceLanguage: 'auto', targetLanguage: settings.defaultTargetLanguage,
    sourceText: '', translatedText: '', message: '正在启动本地 OCR 并分析文字版面…', pinned: false,
    sourceEdited: false, flowMode: 'smart', recognitionMode: settings.recognitionMode
  };
  resultStates.set(id, state);
  const win = createWindow({
    ...position, width: 440, height: 430, minWidth: 360, minHeight: 320,
    frame: false, transparent: true, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    show: false, backgroundColor: '#00000000'
  });
  resultWindows.set(id, win);
  win.on('closed', () => {
    resultWindows.delete(id);
    resultStates.delete(id);
    resultOcrParagraphs.delete(id);
    resultRequestVersions.delete(id);
  });
  await win.loadURL(pageUrl(`result?id=${encodeURIComponent(id)}`));
  win.show();
  return { id, win };
}

async function performTranslation(id: string): Promise<void> {
  const state = resultStates.get(id);
  if (!state || !state.sourceText) return;
  const requestVersion = resultRequestVersions.next(id);
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
    const result = await translateText(state.sourceText, state.sourceLanguage, state.targetLanguage, credentials);
    if (!resultRequestVersions.isLatest(id, requestVersion)) return;
    const ready: ResultState = {
      ...state,
      status: 'ready',
      sourceLanguage: state.sourceLanguage === 'auto' ? result.detectedSourceLanguage : state.sourceLanguage,
      translatedText: result.text,
      message: undefined
    };
    try {
      const history = addHistory({
        id, createdAt: new Date().toISOString(), sourceLanguage: ready.sourceLanguage,
        targetLanguage: ready.targetLanguage, sourceText: ready.sourceText, translatedText: result.text
      });
      broadcastHistory(history);
      sendResult(ready);
    } catch {
      sendResult({ ...ready, message: '翻译已完成，但历史记录保存失败，请检查应用数据目录权限。' });
    }
  } catch (error) {
    if (!resultRequestVersions.isLatest(id, requestVersion)) return;
    sendResult({ ...state, status: 'error', message: error instanceof Error ? error.message : '翻译失败，请重试。' });
  }
}

async function processSelection(selection: CaptureSelection): Promise<void> {
  closeOverlays();
  const { id } = await createResultWindow(selection);
  try {
    const initialState = resultStates.get(id)!;
    const ocr = await recognizeImage(selection.imageDataUrl, initialState.recognitionMode);
    if (!ocr.text) {
      sendResult({ ...resultStates.get(id)!, status: 'empty', confidence: ocr.confidence, message: '没有识别到文字，请重新截图。' });
      return;
    }
    resultOcrParagraphs.set(id, ocr.paragraphs);
    const sourceText = buildTranslationText(ocr.paragraphs, ocr.text, 'smart');
    sendResult({
      ...resultStates.get(id)!, status: 'translating', sourceLanguage: 'auto',
      sourceText, confidence: ocr.confidence, sourceEdited: false,
      message: ocr.confidence < 45 ? '识别置信度较低，翻译结果可能需要校对。' : '识别与版面整理完成，正在翻译…'
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
  app.setLoginItemSettings(process.platform === 'win32'
    ? { openAtLogin: saved.launchAtLogin, path: process.execPath }
    : { openAtLogin: saved.launchAtLogin });
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

function configureMacDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  const icon = nativeImage.createFromPath(brandAssetPath('nintranslate-app-icon.png'));
  if (icon.isEmpty()) {
    console.warn('NinTranslate Dock icon is missing; continuing without a custom Dock icon.');
    return;
  }
  app.dock.setIcon(icon);
}

function registerIpc(): void {
  ipcMain.handle('capture:get-payload', (event) => overlayPayloads.get(event.sender.id));
  ipcMain.handle('capture:complete', (_event, selection: CaptureSelection) => processSelection(selection));
  ipcMain.handle('capture:cancel', () => closeOverlays());
  ipcMain.handle('result:get', (_event, id: string) => resultStates.get(id) ?? null);
  ipcMain.handle('result:retry', (_event, id: string) => performTranslation(id));
  ipcMain.handle('result:set-target', async (_event, id: string, targetLanguage: LanguageCode) => {
    const state = resultStates.get(id);
    if (!state || !isLanguageCode(targetLanguage) || state.targetLanguage === targetLanguage) return;
    sendResult({ ...state, targetLanguage, translatedText: '', status: 'translating', message: '正在翻译到所选语言…' });
    await performTranslation(id);
  });
  ipcMain.handle('result:set-flow-mode', async (_event, id: unknown, mode: unknown) => {
    if (typeof id !== 'string' || !['smart', 'preserve', 'merge'].includes(String(mode))) {
      throw new Error('分段模式无效。');
    }
    const state = resultStates.get(id);
    const paragraphs = resultOcrParagraphs.get(id);
    if (!state || !paragraphs) throw new Error('当前截图的逐行识别数据已经不可用。');
    if (state.sourceEdited) throw new Error('原文已人工编辑，不能再自动重排。');
    if (state.status === 'recognizing' || state.status === 'translating') {
      throw new Error('当前仍在处理文字，请稍后再切换。');
    }
    const flowMode = mode as TextFlowMode;
    if (state.flowMode === flowMode) return;
    const sourceText = buildTranslationText(paragraphs, paragraphs.map(({ text }) => text).join('\n'), flowMode);
    resultRequestVersions.next(id);
    sendResult({
      ...state, flowMode, sourceText, sourceLanguage: 'auto', translatedText: '',
      status: 'translating', message: '正在按新的分段方式重新翻译…'
    });
    await performTranslation(id);
  });
  ipcMain.handle('result:update-source', async (_event, id: unknown, sourceText: unknown) => {
    if (typeof id !== 'string') throw new Error('翻译结果标识无效。');
    const state = resultStates.get(id);
    if (!state) throw new Error('翻译结果窗口已经关闭。');
    if (state.status === 'recognizing' || state.status === 'translating') {
      throw new Error('当前仍在处理文字，请稍后再编辑。');
    }
    const edited = prepareEditedResult(state, sourceText);
    const normalized = edited.sourceText;
    if (normalized === state.sourceText) return;
    resultRequestVersions.next(id);
    sendResult(edited);
    await performTranslation(id);
  });
  ipcMain.handle('result:swap', (_event, id: string) => {
    const state = resultStates.get(id);
    if (!state || state.status !== 'ready' || state.sourceLanguage === 'auto' || !state.translatedText) return;
    resultRequestVersions.next(id);
    const swapped: ResultState = {
      ...state,
      sourceLanguage: state.targetLanguage,
      targetLanguage: state.sourceLanguage,
      sourceText: state.translatedText,
      translatedText: state.sourceText,
      sourceEdited: false
    };
    resultOcrParagraphs.delete(id);
    const history = addHistory({
      id,
      createdAt: new Date().toISOString(),
      sourceLanguage: swapped.sourceLanguage,
      targetLanguage: swapped.targetLanguage,
      sourceText: swapped.sourceText,
      translatedText: swapped.translatedText
    });
    broadcastHistory(history);
    sendResult(swapped);
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
  ipcMain.handle('settings:test', (_event, update: SettingsUpdate) => testTranslatorConnection(update, {
    loadStored: getTranslatorCredentials
  }));
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
  // IPC is core functionality. Register it before any optional UI resources can fail.
  registerIpc();
  app.on('second-instance', (_event, argv) => { if (argv.includes('--capture')) void startCapture(); else openSettings(); });
  app.whenReady().then(() => {
    try { configureMacDockIcon(); } catch (error) { console.error('Unable to configure the macOS Dock icon.', error); }
    try { createTray(); } catch (error) { console.error('Unable to create the tray or menu-bar icon.', error); }
    const settings = getPublicSettings(); nativeTheme.themeSource = settings.theme;
    if (!registerHotkey(settings.hotkey)) openSettings();
    if (process.argv.includes('--capture')) void startCapture();
    else if (!settings.hasCredentials) openSettings();
  });
  app.on('activate', openSettings);
  app.on('window-all-closed', () => { /* Keep tray process alive. */ });
  app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); void terminateOcr(); });
}
