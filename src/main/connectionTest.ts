import type { SettingsUpdate, TestTranslationResult } from '../shared/types';
import { withTimeout } from '../shared/async';
import { translateText, type TranslatorCredentials } from './translator';

interface ConnectionTestDependencies {
  loadStored: (provider: SettingsUpdate['provider']) => TranslatorCredentials;
  translate?: typeof translateText;
  timeoutMs?: number;
}

export function resolveTestCredentials(
  update: SettingsUpdate,
  loadStored: ConnectionTestDependencies['loadStored']
): TranslatorCredentials {
  if (update.provider === 'baidu') {
    const appId = update.baiduAppId?.trim() ?? '';
    const secret = update.baiduSecret?.trim() ?? '';
    if (appId && secret) {
      return { provider: 'baidu', endpoint: update.endpoint, appId, secret };
    }
    const stored = loadStored('baidu');
    return {
      provider: 'baidu',
      endpoint: update.endpoint,
      appId: appId || (stored.provider === 'baidu' ? stored.appId : ''),
      secret: secret || (stored.provider === 'baidu' ? stored.secret : '')
    };
  }

  const apiKey = update.apiKey?.trim() ?? '';
  if (apiKey) {
    return {
      provider: 'microsoft',
      endpoint: update.endpoint,
      region: update.region,
      apiKey
    };
  }
  const stored = loadStored('microsoft');
  return {
    provider: 'microsoft',
    endpoint: update.endpoint,
    region: update.region,
    apiKey: stored.provider === 'microsoft' ? stored.apiKey : ''
  };
}

export async function testTranslatorConnection(
  update: SettingsUpdate,
  dependencies: ConnectionTestDependencies
): Promise<TestTranslationResult> {
  try {
    const credentials = resolveTestCredentials(update, dependencies.loadStored);
    const translate = dependencies.translate ?? translateText;
    const translated = await withTimeout(
      translate('Hello', 'en', 'zh-Hans', credentials, 12000),
      dependencies.timeoutMs ?? 16000,
      '连接测试超时。请求已停止，请检查网络、代理或系统钥匙串后重试。'
    );
    return { ok: true, message: `连接成功：Hello → ${translated.text}` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '连接测试失败。'
    };
  }
}
