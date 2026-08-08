import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsUpdate } from '../shared/types';
import { resolveTestCredentials, testTranslatorConnection } from './connectionTest';

const baiduUpdate: SettingsUpdate = {
  provider: 'baidu',
  endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
  region: '',
  hotkey: 'CommandOrControl+Shift+T',
  launchAtLogin: false,
  theme: 'system',
  defaultTargetLanguage: 'zh-Hans',
  baiduAppId: 'fresh-id',
  baiduSecret: 'fresh-secret'
};

afterEach(() => {
  vi.useRealTimers();
});

describe('connection test service', () => {
  it('does not touch Keychain when fresh Baidu credentials are entered', () => {
    const loadStored = vi.fn(() => {
      throw new Error('Keychain should not be read');
    });
    expect(resolveTestCredentials(baiduUpdate, loadStored)).toMatchObject({
      provider: 'baidu',
      appId: 'fresh-id',
      secret: 'fresh-secret'
    });
    expect(loadStored).not.toHaveBeenCalled();
  });

  it('returns a Keychain error instead of rejecting IPC', async () => {
    const result = await testTranslatorConnection(
      { ...baiduUpdate, baiduAppId: undefined, baiduSecret: undefined },
      { loadStored: () => { throw new Error('钥匙串不可用'); } }
    );
    expect(result).toEqual({ ok: false, message: '钥匙串不可用' });
  });

  it('returns a successful translation result', async () => {
    const result = await testTranslatorConnection(baiduUpdate, {
      loadStored: vi.fn(),
      translate: vi.fn().mockResolvedValue({ text: '你好', detectedSourceLanguage: 'en' })
    });
    expect(result).toEqual({ ok: true, message: '连接成功：Hello → 你好' });
  });

  it('stops a translator dependency that never resolves', async () => {
    vi.useFakeTimers();
    const pending = testTranslatorConnection(baiduUpdate, {
      loadStored: vi.fn(),
      translate: vi.fn(() => new Promise(() => undefined)),
      timeoutMs: 20
    });
    await vi.advanceTimersByTimeAsync(21);
    await expect(pending).resolves.toMatchObject({ ok: false });
  });
});
