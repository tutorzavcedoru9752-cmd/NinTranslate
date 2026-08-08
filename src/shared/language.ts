import type { LanguageCode, SourceLanguageCode } from './types';

export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: LanguageCode; label: string; tesseract: string }> = [
  { code: 'zh-Hans', label: '简体中文', tesseract: 'chi_sim' },
  { code: 'zh-Hant', label: '繁体中文', tesseract: 'chi_tra' },
  { code: 'en', label: '英语', tesseract: 'eng' },
  { code: 'ja', label: '日语', tesseract: 'jpn' },
  { code: 'ko', label: '韩语', tesseract: 'kor' },
  { code: 'fr', label: '法语', tesseract: 'fra' },
  { code: 'de', label: '德语', tesseract: 'deu' },
  { code: 'es', label: '西班牙语', tesseract: 'spa' },
  { code: 'pt', label: '葡萄牙语', tesseract: 'por' },
  { code: 'ru', label: '俄语', tesseract: 'rus' }
];

const languageCodes = new Set<LanguageCode>(SUPPORTED_LANGUAGES.map(({ code }) => code));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && languageCodes.has(value as LanguageCode);
}

export function languageLabel(code: SourceLanguageCode): string {
  if (code === 'auto') return '自动识别';
  return SUPPORTED_LANGUAGES.find((language) => language.code === code)?.label ?? '自动识别';
}
