import { describe, expect, it } from 'vitest';
import { inferTranslationDirection } from './language';

describe('inferTranslationDirection', () => {
  it('detects Chinese text', () => expect(inferTranslationDirection('欢迎使用截图翻译')).toEqual({ source: 'zh-Hans', target: 'en' }));
  it('detects English text', () => expect(inferTranslationDirection('Screenshot translation ready')).toEqual({ source: 'en', target: 'zh-Hans' }));
  it('treats English UI text with one Chinese label as Chinese when meaningful', () => expect(inferTranslationDirection('设置 Settings')).toEqual({ source: 'zh-Hans', target: 'en' }));
});
