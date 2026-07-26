export type LanguageCode = 'zh-Hans' | 'en';
export type ThemeMode = 'system' | 'light' | 'dark';
export type TranslationProvider = 'baidu' | 'microsoft';

export interface PublicSettings {
  provider: TranslationProvider;
  endpoint: string;
  region: string;
  hotkey: string;
  launchAtLogin: boolean;
  theme: ThemeMode;
  hasCredentials: boolean;
  hasBaiduCredentials: boolean;
  hasMicrosoftApiKey: boolean;
}

export interface SettingsUpdate {
  provider: TranslationProvider;
  endpoint: string;
  region: string;
  hotkey: string;
  launchAtLogin: boolean;
  theme: ThemeMode;
  baiduAppId?: string;
  baiduSecret?: string;
  apiKey?: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sourceText: string;
  translatedText: string;
}

export type ResultStatus = 'recognizing' | 'translating' | 'ready' | 'needs-config' | 'error' | 'empty';

export interface ResultState {
  id: string;
  status: ResultStatus;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sourceText: string;
  translatedText: string;
  confidence?: number;
  message?: string;
  pinned: boolean;
}

export interface CapturePayload {
  displayId: string;
  imageDataUrl: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface CaptureSelection {
  imageDataUrl: string;
  screenBounds: { x: number; y: number; width: number; height: number };
}

export interface TestTranslationResult { ok: boolean; message: string }
