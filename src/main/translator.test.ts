import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeProviderLanguage, toBaiduLanguage, toMicrosoftLanguage, translateText
} from './translator';

afterEach(() => vi.unstubAllGlobals());

const baiduCredentials = {
  provider: 'baidu' as const,
  endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
  appId: 'app-id',
  secret: 'secret'
};

describe('translator language mapping', () => {
  it('maps all supported languages for Baidu and Microsoft', () => {
    expect([
      toBaiduLanguage('zh-Hans'), toBaiduLanguage('zh-Hant'), toBaiduLanguage('en'),
      toBaiduLanguage('ja'), toBaiduLanguage('ko'), toBaiduLanguage('fr'),
      toBaiduLanguage('de'), toBaiduLanguage('es'), toBaiduLanguage('pt'), toBaiduLanguage('ru')
    ]).toEqual(['zh', 'cht', 'en', 'jp', 'kor', 'fra', 'de', 'spa', 'pt', 'ru']);
    expect(toMicrosoftLanguage('zh-Hant')).toBe('zh-Hant');
    expect(toMicrosoftLanguage('ja')).toBe('ja');
  });

  it('normalizes provider-specific detected language codes', () => {
    expect(normalizeProviderLanguage('jp')).toBe('ja');
    expect(normalizeProviderLanguage('kor')).toBe('ko');
    expect(normalizeProviderLanguage('zh-Hant')).toBe('zh-Hant');
    expect(normalizeProviderLanguage('unsupported')).toBe('auto');
  });
});

describe('translateText', () => {
  it('sends Baidu automatic source detection and parses the detected language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      from: 'jp',
      to: 'zh',
      trans_result: [{ src: 'こんにちは', dst: '你好' }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateText('こんにちは', 'auto', 'zh-Hans', baiduCredentials)).resolves.toEqual({
      text: '你好',
      detectedSourceLanguage: 'ja'
    });
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('from')).toBe('auto');
    expect(body.get('to')).toBe('zh');
  });

  it('maps a Baidu invalid-sign response to an auth error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error_code: '54001',
      error_msg: 'Invalid Sign'
    }), { status: 200 })));
    await expect(translateText('hello', 'auto', 'zh-Hans', {
      ...baiduCredentials,
      appId: 'bad',
      secret: 'bad'
    })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('aborts a Baidu request that exceeds the deadline', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    await expect(translateText('hello', 'auto', 'zh-Hans', baiduCredentials, 10)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('lets Microsoft auto-detect the source and parses its detected language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      detectedLanguage: { language: 'ru' },
      translations: [{ text: '你好' }]
    }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(translateText('Привет', 'auto', 'zh-Hans', {
      provider: 'microsoft', endpoint: 'https://example.com', region: '', apiKey: 'key'
    })).resolves.toEqual({ text: '你好', detectedSourceLanguage: 'ru' });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.get('to')).toBe('zh-Hans');
  });

  it('maps Microsoft invalid credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(translateText('hello', 'auto', 'zh-Hans', {
      provider: 'microsoft', endpoint: 'https://example.com', region: '', apiKey: 'bad'
    })).rejects.toMatchObject({ kind: 'auth' });
  });
});
