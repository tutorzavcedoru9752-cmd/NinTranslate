import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { HistoryEntry, PublicSettings, SettingsUpdate, ThemeMode, TranslationProvider } from '../shared/types';
import type { TranslatorCredentials } from './translator';

interface StoredSettings {
  provider: TranslationProvider;
  endpoint: string;
  region: string;
  hotkey: string;
  launchAtLogin: boolean;
  theme: ThemeMode;
  encryptedApiKey?: string;
  encryptedBaiduAppId?: string;
  encryptedBaiduSecret?: string;
}

const defaults: StoredSettings = {
  provider: 'baidu',
  endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
  region: '',
  hotkey: process.platform === 'darwin' ? 'CommandOrControl+Shift+T' : 'Alt+Shift+T',
  launchAtLogin: false,
  theme: 'system'
};

function dataPath(name: string): string {
  return path.join(app.getPath('userData'), name);
}

function readJson<T>(name: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(dataPath(name), 'utf8')) as T; }
  catch { return fallback; }
}

function writeJson(name: string, value: unknown): void {
  const target = dataPath(name);
  const temp = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, target);
}

export function getStoredSettings(): StoredSettings {
  const saved = readJson<Partial<StoredSettings>>('settings.json', {});
  const provider = saved.provider ?? (saved.encryptedApiKey ? 'microsoft' : 'baidu');
  return { ...defaults, ...saved, provider };
}

export function getPublicSettings(): PublicSettings {
  const settings = getStoredSettings();
  const hasBaiduCredentials = Boolean(settings.encryptedBaiduAppId && settings.encryptedBaiduSecret);
  const hasMicrosoftApiKey = Boolean(settings.encryptedApiKey);
  return {
    provider: settings.provider,
    endpoint: settings.endpoint,
    region: settings.region,
    hotkey: settings.hotkey,
    launchAtLogin: settings.launchAtLogin,
    theme: settings.theme,
    hasCredentials: settings.provider === 'baidu' ? hasBaiduCredentials : hasMicrosoftApiKey,
    hasBaiduCredentials,
    hasMicrosoftApiKey
  };
}

function decryptCredential(encrypted: string | undefined, label: string): string {
  if (!encrypted) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error(`当前系统无法安全解密${label}。`);
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); }
  catch { throw new Error(`${label}无法解密，请在设置中重新填写。`); }
}

export function getTranslatorCredentials(provider = getStoredSettings().provider): TranslatorCredentials {
  const settings = getStoredSettings();
  if (provider === 'baidu') {
    return {
      provider,
      endpoint: settings.endpoint,
      appId: decryptCredential(settings.encryptedBaiduAppId, '百度 APP ID'),
      secret: decryptCredential(settings.encryptedBaiduSecret, '百度翻译密钥')
    };
  }
  return {
    provider,
    endpoint: settings.endpoint,
    region: settings.region,
    apiKey: decryptCredential(settings.encryptedApiKey, 'Microsoft API 密钥')
  };
}

export function saveSettings(update: SettingsUpdate): PublicSettings {
  const current = getStoredSettings();
  const next: StoredSettings = {
    ...current,
    provider: update.provider,
    endpoint: update.endpoint.trim().replace(/\/$/, '') || defaults.endpoint,
    region: update.region.trim(),
    hotkey: update.hotkey.trim() || defaults.hotkey,
    launchAtLogin: update.launchAtLogin,
    theme: update.theme
  };
  if (update.apiKey?.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全保存 API 密钥。');
    next.encryptedApiKey = safeStorage.encryptString(update.apiKey.trim()).toString('base64');
  }
  if (update.baiduAppId?.trim() || update.baiduSecret?.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全保存百度翻译凭据。');
    if (update.baiduAppId?.trim()) next.encryptedBaiduAppId = safeStorage.encryptString(update.baiduAppId.trim()).toString('base64');
    if (update.baiduSecret?.trim()) next.encryptedBaiduSecret = safeStorage.encryptString(update.baiduSecret.trim()).toString('base64');
  }
  writeJson('settings.json', next);
  return getPublicSettings();
}

export function listHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>('history.json', []);
}

export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const history = listHistory().filter((item) => item.id !== entry.id);
  history.unshift(entry);
  const next = history.slice(0, 500);
  writeJson('history.json', next);
  return next;
}

export function deleteHistory(id: string): HistoryEntry[] {
  const next = listHistory().filter((item) => item.id !== id);
  writeJson('history.json', next);
  return next;
}

export function clearHistory(): HistoryEntry[] {
  const next: HistoryEntry[] = [];
  writeJson('history.json', next);
  return next;
}
