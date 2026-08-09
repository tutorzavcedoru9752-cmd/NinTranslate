import { describe, expect, it } from 'vitest';
import { isRecognitionMode, recognitionModeLabel, RECOGNITION_MODES } from './recognition';

describe('recognition modes', () => {
  it('offers a fast Chinese-English mode and a multilingual mode', () => {
    expect(RECOGNITION_MODES.map(({ code }) => code)).toEqual(['zh-en-fast', 'multilingual']);
    expect(recognitionModeLabel('zh-en-fast')).toContain('中英快速');
    expect(recognitionModeLabel('multilingual')).toContain('多语言');
  });

  it('rejects unknown persisted values', () => {
    expect(isRecognitionMode('zh-en-fast')).toBe(true);
    expect(isRecognitionMode('multilingual')).toBe(true);
    expect(isRecognitionMode('auto')).toBe(false);
    expect(isRecognitionMode(null)).toBe(false);
  });
});
