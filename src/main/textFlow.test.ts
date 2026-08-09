import { describe, expect, it } from 'vitest';
import type { OcrParagraph } from './ocr';
import { buildTranslationText } from './textFlow';

function line(text: string, y: number, x = 0, height = 20): OcrParagraph {
  return { text, confidence: 95, bounds: { x, y, width: 180, height } };
}

describe('translation text flow', () => {
  it('joins wrapped Chinese lines without inserting spaces', () => {
    expect(buildTranslationText([
      line('这是一句因为版面宽度', 0),
      line('而被换行的完整中文。', 24)
    ], '')).toBe('这是一句因为版面宽度而被换行的完整中文。');
  });

  it('joins wrapped Latin lines with a space', () => {
    expect(buildTranslationText([
      line('This sentence wraps onto', 0),
      line('the next visual line.', 24)
    ], '')).toBe('This sentence wraps onto the next visual line.');
  });

  it('repairs a Latin word split with a soft line hyphen', () => {
    expect(buildTranslationText([
      line('A cross-platform trans-', 0),
      line('lation application.', 24)
    ], '')).toBe('A cross-platform translation application.');
  });

  it('keeps visibly separated paragraphs apart', () => {
    expect(buildTranslationText([
      line('First paragraph.', 0),
      line('Second paragraph.', 55)
    ], '')).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('uses normalized fallback text when OCR boxes are unavailable', () => {
    expect(buildTranslationText([], 'one line\ncontinues here')).toBe('one line continues here');
  });
});
