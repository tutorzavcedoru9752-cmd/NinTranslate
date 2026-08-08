import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => path.resolve(__dirname, '..', '..')
  }
}));

import { recognizeImage, terminateOcr } from './ocr';

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

afterAll(async () => terminateOcr());

describe('ten-language offline OCR', () => {
  for (const [code, expected] of fixtures) {
    it(`recognizes ${code}`, async () => {
      const imagePath = path.resolve(__dirname, '__fixtures__', 'ocr', `${code}.png`);
      const result = await recognizeImage(imagePath);
      const normalized = result.text.normalize('NFC').replace(/\s+/g, '').trim().toLocaleLowerCase();
      const expectedNormalized = expected.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase();
      expect(normalized).toContain(expectedNormalized);
      expect(result.paragraphs.length).toBeGreaterThan(0);
    }, 120_000);
  }
});
