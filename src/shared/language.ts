import type { LanguageCode, SourceLanguageCode } from './types';

export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: LanguageCode; label: string }> = [
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'zh-Hant', label: '繁体中文' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'ru', label: '俄语' }
];

const languageCodes = new Set<LanguageCode>(SUPPORTED_LANGUAGES.map(({ code }) => code));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && languageCodes.has(value as LanguageCode);
}

export function languageLabel(code: SourceLanguageCode): string {
  if (code === 'auto') return '自动识别';
  return SUPPORTED_LANGUAGES.find((language) => language.code === code)?.label ?? '自动识别';
}
