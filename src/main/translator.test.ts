import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateText } from './translator';

afterEach(() => vi.unstubAllGlobals());

describe('translateText', () => {
  it('parses a Baidu translation response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      from: 'zh',
      to: 'en',
      trans_result: [{ src: '你好', dst: 'Hello' }]
    }), { status: 200 })));
    await expect(translateText('你好', 'zh-Hans', 'en', {
      provider: 'baidu',
      endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
      appId: 'app-id',
      secret: 'secret'
    })).resolves.toBe('Hello');
  });
  it('maps a Baidu invalid-sign response to an auth error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error_code: '54001',
      error_msg: 'Invalid Sign'
    }), { status: 200 })));
    await expect(translateText('hello', 'en', 'zh-Hans', {
      provider: 'baidu',
      endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
      appId: 'bad',
      secret: 'bad'
    })).rejects.toMatchObject({ kind: 'auth' });
  });
  it('aborts a Baidu request that exceeds the deadline', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    await expect(translateText('hello', 'en', 'zh-Hans', {
      provider: 'baidu',
      endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
      appId: 'app-id',
      secret: 'secret'
    }, 10)).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('parses a Microsoft translation response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ translations: [{ text: 'Hello' }] }]), { status: 200 })));
    await expect(translateText('你好', 'zh-Hans', 'en', {
      provider: 'microsoft',
      endpoint: 'https://example.com',
      region: '',
      apiKey: 'key'
    })).resolves.toBe('Hello');
  });
  it('maps Microsoft invalid credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(translateText('hello', 'en', 'zh-Hans', {
      provider: 'microsoft',
      endpoint: 'https://example.com',
      region: '',
      apiKey: 'bad'
    })).rejects.toMatchObject({ kind: 'auth' });
  });
});
