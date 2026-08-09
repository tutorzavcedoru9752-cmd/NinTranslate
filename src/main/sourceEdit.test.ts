import { describe, expect, it } from 'vitest';
import type { ResultState } from '../shared/types';
import { normalizeEditedSource, prepareEditedResult } from './sourceEdit';

describe('normalizeEditedSource', () => {
  it('normalizes platform newlines but preserves intentional paragraph breaks', () => {
    expect(normalizeEditedSource('  First paragraph\r\n\r\nSecond paragraph  '))
      .toBe('First paragraph\n\nSecond paragraph');
  });

  it('removes trailing spaces without changing leading indentation inside the text', () => {
    expect(normalizeEditedSource('First  \n  indented line\t'))
      .toBe('First\n  indented line');
  });

  it('rejects empty and non-string values', () => {
    expect(() => normalizeEditedSource(' \n ')).toThrow('原文不能为空');
    expect(() => normalizeEditedSource(null)).toThrow('格式无效');
  });

  it('keeps the target and pin state while resetting source detection for retranslation', () => {
    const state: ResultState = {
      id: 'result-1', status: 'ready', sourceLanguage: 'en', targetLanguage: 'zh-Hant',
      sourceText: 'Wrong text', translatedText: '旧译文', confidence: 72, pinned: true,
      sourceEdited: false,
      flowMode: 'smart'
    };
    expect(prepareEditedResult(state, 'Correct text')).toMatchObject({
      sourceText: 'Correct text', sourceLanguage: 'auto', targetLanguage: 'zh-Hant',
      translatedText: '', status: 'translating', sourceEdited: true, pinned: true, flowMode: 'smart'
    });
  });
});
