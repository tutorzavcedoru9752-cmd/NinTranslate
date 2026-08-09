import { describe, expect, it } from 'vitest';
import { isLanguageCode, languageLabel, SUPPORTED_LANGUAGES } from './language';

describe('supported languages', () => {
  it('contains the ten bundled OCR languages', () => {
    expect(SUPPORTED_LANGUAGES.map(({ code }) => code)).toEqual([
      'zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru'
    ]);
    expect(new Set(SUPPORTED_LANGUAGES.map(({ code }) => code)).size).toBe(10);
  });

  it('validates persisted language codes', () => {
    expect(isLanguageCode('ja')).toBe(true);
    expect(isLanguageCode('auto')).toBe(false);
    expect(isLanguageCode('xx')).toBe(false);
  });

  it('labels automatic and known languages', () => {
    expect(languageLabel('auto')).toBe('自动识别');
    expect(languageLabel('zh-Hant')).toBe('繁体中文');
    expect(languageLabel('ru')).toBe('俄语');
  });
});
