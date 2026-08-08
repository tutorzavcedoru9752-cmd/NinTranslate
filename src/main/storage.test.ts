import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '.vitest-storage' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}));

import { addHistory, clearHistory, deleteHistory, getPublicSettings, listHistory } from './storage';

const historyPath = path.join('.vitest-storage', 'history.json');
const settingsPath = path.join('.vitest-storage', 'settings.json');
const entry = {
  id: 'history-test',
  createdAt: '2026-07-25T00:00:00.000Z',
  sourceLanguage: 'zh-Hans' as const,
  targetLanguage: 'en' as const,
  sourceText: '测试原文',
  translatedText: 'Test translation'
};

beforeEach(() => {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, '[]', 'utf8');
  fs.writeFileSync(settingsPath, '{}', 'utf8');
});

describe('settings migration', () => {
  it('defaults old settings files to Simplified Chinese', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ provider: 'baidu' }), 'utf8');
    expect(getPublicSettings().defaultTargetLanguage).toBe('zh-Hans');
  });

  it('keeps a valid saved target language and rejects unknown values', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ defaultTargetLanguage: 'ja' }), 'utf8');
    expect(getPublicSettings().defaultTargetLanguage).toBe('ja');
    fs.writeFileSync(settingsPath, JSON.stringify({ defaultTargetLanguage: 'xx' }), 'utf8');
    expect(getPublicSettings().defaultTargetLanguage).toBe('zh-Hans');
  });
});

describe('history storage', () => {
  it('adds and lists a completed translation', () => {
    expect(addHistory(entry)).toEqual([entry]);
    expect(listHistory()).toEqual([entry]);
  });

  it('updates the same screenshot history instead of creating a duplicate', () => {
    addHistory(entry);
    const updated = {
      ...entry,
      targetLanguage: 'ja' as const,
      translatedText: 'テスト翻訳'
    };

    expect(addHistory(updated)).toEqual([updated]);
    expect(listHistory()).toEqual([updated]);
  });

  it('deletes one history record', () => {
    addHistory(entry);
    expect(deleteHistory(entry.id)).toEqual([]);
    expect(listHistory()).toEqual([]);
  });

  it('clears every history record', () => {
    addHistory(entry);
    expect(clearHistory()).toEqual([]);
    expect(listHistory()).toEqual([]);
  });
});
