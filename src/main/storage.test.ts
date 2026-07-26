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

import { addHistory, clearHistory, deleteHistory, listHistory } from './storage';

const historyPath = path.join('.vitest-storage', 'history.json');
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
});

describe('history storage', () => {
  it('adds and lists a completed translation', () => {
    expect(addHistory(entry)).toEqual([entry]);
    expect(listHistory()).toEqual([entry]);
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
