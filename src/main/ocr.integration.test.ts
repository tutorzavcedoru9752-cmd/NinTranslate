import path from 'node:path';
import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => path.resolve(__dirname, '..', '..')
  }
}));

import { recognizeImage, terminateOcr } from './ocr';
import { buildTranslationText } from './textFlow';

const fixtures = [
  ['zh-Hans', '截图翻译'],
  ['zh-Hant', '螢幕翻譯'],
  ['en', 'Screenshot translation'],
  ['ja', '画面翻訳'],
  ['ko', '화면 번역'],
  ['fr', 'Traduction française'],
  ['de', 'Deutsche Übersetzung'],
  ['es', 'Traducción española'],
  ['pt', 'Tradução portuguesa'],
  ['ru', 'Перевод экрана']
] as const;

const realWorldFixtures = [
  {
    filename: 'real-ja-light.png',
    rows: [
      'ここで重要な疑問が生じます。AIが私たちのことをより深く理解する',
      'につれて、どのようにプライバシーを保護すべきなのでしょうか？こ',
      'れから数分間、AIの進化、技術アーキテクチャ、メモリ機構、インタ',
      'ラクションデザインという4つの視点から、この問題を探っていきま',
      'す。'
    ],
    translationText: 'ここで重要な疑問が生じます。AIが私たちのことをより深く理解するにつれて、どのようにプライバシーを保護すべきなのでしょうか？これから数分間、AIの進化、技術アーキテクチャ、メモリ機構、インタラクションデザインという4つの視点から、この問題を探っていきます。'
  },
  {
    filename: 'real-en-dark.png',
    rows: [
      'This brings up a critical question: as AI',
      'gets to know us more and more, how',
      'should it protect our privacy? Over the',
      "next few minutes, we'll explore this",
      'from four angles: the evolution of AI,',
      'technical architecture, memory',
      'mechanisms, and interaction design.'
    ],
    translationText: "This brings up a critical question: as AI gets to know us more and more, how should it protect our privacy? Over the next few minutes, we'll explore this from four angles: the evolution of AI, technical architecture, memory mechanisms, and interaction design."
  },
  {
    filename: 'real-zh-numbered.png',
    rows: [
      '1. 这就引出了一个关键问题：随着人工智能越来越了解我们，它应该如何保护我们的隐',
      '私？接下来几分钟，我们将从四个角度探讨这个问题：人工智能的演进、技术架构、记',
      '忆机制和交互设计。'
    ],
    translationText: '1. 这就引出了一个关键问题：随着人工智能越来越了解我们，它应该如何保护我们的隐私？接下来几分钟，我们将从四个角度探讨这个问题：人工智能的演进、技术架构、记忆机制和交互设计。'
  },
  {
    filename: 'real-ru-dark-subpixel.png',
    rows: [
      'Точный порядок чтения помогает правильно',
      'переводить текст из нескольких визуальных строк.'
    ],
    translationText: 'Точный порядок чтения помогает правильно переводить текст из нескольких визуальных строк.'
  }
] as const;

afterAll(async () => terminateOcr());

describe('ten-language offline OCR', () => {
  for (const [code, expected] of fixtures) {
    it(`recognizes ${code}`, async () => {
      const imagePath = path.resolve(__dirname, '__fixtures__', 'ocr', `${code}.png`);
      const imageData = `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
      const result = await recognizeImage(imageData);
      const normalized = result.text.normalize('NFC').replace(/\s+/g, '').trim().toLocaleLowerCase();
      const expectedNormalized = expected.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase();
      expect(normalized).toContain(expectedNormalized);
      expect(result.paragraphs.length).toBeGreaterThan(0);
      expect(result.layoutApplied).toBe(false);
      expect(result.layoutElapsedMs).toBe(0);
      if (code === 'ja') expect(result.highAccuracyApplied).toBe(true);
    }, 120_000);
  }

  it('assigns multiline OCR rows to local layout blocks without writing the screenshot', async () => {
    const imagePath = path.resolve(__dirname, '__fixtures__', 'ocr', 'layout-paragraphs.png');
    const imageData = `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
    const result = await recognizeImage(imageData);
    const blockIds = new Set(result.paragraphs.map((paragraph) => paragraph.layoutBlockId).filter(Boolean));
    expect(result.layoutApplied).toBe(true);
    expect(result.layoutElapsedMs).toBeGreaterThan(0);
    expect(result.layoutElapsedMs).toBeLessThan(2_000);
    expect(blockIds.size).toBeGreaterThanOrEqual(1);
    expect(result.paragraphs.some((paragraph) => paragraph.layoutType)).toBe(true);
    expect(result.paragraphs.some((paragraph) => !paragraph.layoutBlockId)).toBe(true);
  }, 120_000);

  for (const fixture of realWorldFixtures) {
    it(`preserves every character and joins only visual wraps in ${fixture.filename}`, async () => {
      const imagePath = path.resolve(__dirname, '__fixtures__', 'ocr', fixture.filename);
      const imageData = `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
      const result = await recognizeImage(imageData);
      expect(result.paragraphs.map(({ text }) => text)).toEqual([...fixture.rows]);
      expect(result.text).toBe(fixture.rows.join('\n'));
      expect(buildTranslationText(result.paragraphs, result.text)).toBe(fixture.translationText);
      expect(result.layoutApplied).toBe(true);
      expect(result.confidence).toBeGreaterThan(95);
    }, 120_000);
  }
});
