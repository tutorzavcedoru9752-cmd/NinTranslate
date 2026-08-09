import { describe, expect, it } from 'vitest';
import type { OcrParagraph } from './ocr';
import { buildTranslationText } from './textFlow';

function line(text: string, y: number, x = 0, height = 20, layoutBlockId?: string, width = 180): OcrParagraph {
  return { text, confidence: 95, bounds: { x, y, width, height }, layoutBlockId };
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

  it('uses different layout blocks as hard paragraph boundaries even when spacing is small', () => {
    const title = line('Section title', 0, 0, 20, 'title');
    title.layoutType = 'title';
    const body = line('Body text starts here.', 23, 0, 20, 'body');
    body.layoutType = 'text';
    expect(buildTranslationText([title, body], '')).toBe('Section title\n\nBody text starts here.');
  });

  it('does not split adjacent lines when layout finds multiple blocks of the same type', () => {
    const first = line('本地识别可以保护截图隐私，只有整', 0, 0, 20, 'title-a');
    first.layoutType = 'title';
    const second = line('理后的文字才会发送给翻译服务。', 24, 0, 20, 'title-b');
    second.layoutType = 'title';
    expect(buildTranslationText([first, second], '')).toBe('本地识别可以保护截图隐私，只有整理后的文字才会发送给翻译服务。');
  });

  it('keeps wrapped lines in the same layout block together', () => {
    expect(buildTranslationText([
      line('A sentence remains in', 0, 0, 20, 'body'),
      line('the same detected block.', 24, 0, 20, 'body')
    ], '')).toBe('A sentence remains in the same detected block.');
  });

  it('orders a two-column layout down the left column before the right column', () => {
    expect(buildTranslationText([
      line('Left first', 0, 0, 20, 'left'),
      line('Right first', 0, 260, 20, 'right'),
      line('Left second.', 24, 0, 20, 'left'),
      line('Right second.', 24, 260, 20, 'right')
    ], '')).toBe('Left first Left second.\n\nRight first Right second.');
  });

  it('uses normalized fallback text when OCR boxes are unavailable', () => {
    expect(buildTranslationText([], 'one line\ncontinues here')).toBe('one line continues here');
  });

  it('does not mistake varying headline widths for multiple columns', () => {
    expect(buildTranslationText([
      line('US Navy launches billion-', 0, 0, 20, undefined, 248),
      line('dollar drone from aircraft', 24, 0, 20, undefined, 230),
      line('carrier in the ocean', 48, 0, 20, undefined, 175)
    ], '')).toBe('US Navy launches billion-dollar drone from aircraft carrier in the ocean');
  });

  it('reconstructs same-baseline OCR fragments before paragraph analysis', () => {
    expect(buildTranslationText([
      line('So today’s AI is more', 0, 0, 20, undefined, 165),
      line('like a', 0, 174, 20, undefined, 48),
      line('knowledgeable but impersonal', 24, 0, 20, undefined, 225),
      line('temporary assistant.', 48, 0, 20, undefined, 160)
    ], '')).toBe('So today’s AI is more like a knowledgeable but impersonal temporary assistant.');
  });

  it('deduplicates the shared character in overlapping same-line OCR boxes', () => {
    expect(buildTranslationText([
      line('Reading', 0, 0, 32, 'body', 105),
      line('g continues', 1, 87, 31, 'body', 135)
    ], '')).toBe('Reading continues');
  });

  it('keeps a narrow but persistent gutter as a two-column boundary', () => {
    expect(buildTranslationText([
      line('Left column starts here.', 0, 0, 34, 'same', 279),
      line('Right column starts here.', 0, 388, 34, 'same', 296),
      line('Its second line stays in the', 36, 0, 34, 'same', 311),
      line('Reading continues', 36, 389, 34, 'same', 222),
      line('same column.', 72, 0, 34, 'same', 168),
      line('downward before switching columns.', 72, 389, 34, 'same', 300)
    ], '')).toBe('Left column starts here. Its second line stays in the same column.\n\nRight column starts here. Reading continues downward before switching columns.');
  });

  it('uses a detected horizontal separator as a hard paragraph boundary', () => {
    const second = line('VR/AR共性需求、VR特色需求', 24);
    second.hardBreakBefore = true;
    expect(buildTranslationText([
      line('明确项目目标、系统服务对象', 0),
      second
    ], '')).toBe('明确项目目标、系统服务对象\n\nVR/AR共性需求、VR特色需求');
  });

  it('offers visual-line and forced-merge modes without re-running OCR', () => {
    const lines = [line('First visual line', 0), line('second visual line.', 24)];
    expect(buildTranslationText(lines, '', 'preserve')).toBe('First visual line\nsecond visual line.');
    expect(buildTranslationText(lines, '', 'merge')).toBe('First visual line second visual line.');
  });
});
