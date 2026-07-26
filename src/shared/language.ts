import type { LanguageCode } from './types';

export function inferTranslationDirection(text: string): { source: LanguageCode; target: LanguageCode } {
  const han = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return han > 0 && han >= latin * 0.12
    ? { source: 'zh-Hans', target: 'en' }
    : { source: 'en', target: 'zh-Hans' };
}

export function languageLabel(code: LanguageCode): string {
  return code === 'zh-Hans' ? '中文' : '英文';
}
