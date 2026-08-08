import { createHash, randomUUID } from 'node:crypto';
import type { LanguageCode, SourceLanguageCode, TranslationResult } from '../shared/types';

export interface BaiduTranslatorCredentials {
  provider: 'baidu';
  endpoint: string;
  appId: string;
  secret: string;
}

export interface MicrosoftTranslatorCredentials {
  provider: 'microsoft';
  endpoint: string;
  region: string;
  apiKey: string;
}

export type TranslatorCredentials = BaiduTranslatorCredentials | MicrosoftTranslatorCredentials;

export class TranslationError extends Error {
  constructor(message: string, public readonly kind: 'auth' | 'quota' | 'network' | 'timeout' | 'service') { super(message); }
}

export async function translateText(
  text: string,
  source: SourceLanguageCode,
  target: LanguageCode,
  credentials: TranslatorCredentials,
  timeoutMs = 15000
): Promise<TranslationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return credentials.provider === 'baidu'
      ? await translateWithBaidu(text, source, target, credentials, controller.signal)
      : await translateWithMicrosoft(text, source, target, credentials, controller.signal);
  } catch (error) {
    if (error instanceof TranslationError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new TranslationError('翻译请求超时，请检查网络后重试。', 'timeout');
    throw new TranslationError('无法连接翻译服务，请检查网络。', 'network');
  } finally { clearTimeout(timer); }
}

async function translateWithBaidu(
  text: string,
  source: SourceLanguageCode,
  target: LanguageCode,
  credentials: BaiduTranslatorCredentials,
  signal: AbortSignal
): Promise<TranslationResult> {
  if (!credentials.appId || !credentials.secret) {
    throw new TranslationError('请先在设置中填写百度翻译 APP ID 和密钥。', 'auth');
  }
  const salt = randomUUID();
  const sign = createHash('md5').update(`${credentials.appId}${text}${salt}${credentials.secret}`, 'utf8').digest('hex');
  const body = new URLSearchParams({
    q: text,
    from: source === 'auto' ? 'auto' : toBaiduLanguage(source),
    to: toBaiduLanguage(target),
    appid: credentials.appId,
    salt,
    sign
  });
  const response = await fetch(credentials.endpoint.replace(/\/$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
    signal
  });
  if (!response.ok) throw new TranslationError(`百度翻译暂时不可用（HTTP ${response.status}）。`, 'service');
  const data = await response.json() as {
    error_code?: string | number;
    error_msg?: string;
    from?: string;
    trans_result?: Array<{ dst?: string }>;
  };
  if (data.error_code && String(data.error_code) !== '52000') {
    throw baiduError(String(data.error_code));
  }
  const translated = data.trans_result?.map((item) => item.dst?.trim()).filter(Boolean).join('\n');
  if (!translated) throw new TranslationError('百度翻译没有返回有效内容。', 'service');
  return { text: translated, detectedSourceLanguage: normalizeProviderLanguage(data.from) };
}

function baiduError(code: string): TranslationError {
  if (['52003', '54001', '58000', '58002', '90107'].includes(code)) {
    return new TranslationError(`百度翻译凭据或服务配置不正确（错误 ${code}），请检查 APP ID、密钥及服务开通状态。`, 'auth');
  }
  if (['54003', '54004', '54005'].includes(code)) {
    return new TranslationError(`百度翻译额度或调用频率已达到限制（错误 ${code}），请稍后重试。`, 'quota');
  }
  if (code === '52001') return new TranslationError('百度翻译请求超时，请稍后重试。', 'timeout');
  return new TranslationError(`百度翻译服务返回错误 ${code}。`, 'service');
}

async function translateWithMicrosoft(
  text: string,
  source: SourceLanguageCode,
  target: LanguageCode,
  credentials: MicrosoftTranslatorCredentials,
  signal: AbortSignal
): Promise<TranslationResult> {
  if (!credentials.apiKey) throw new TranslationError('请先在设置中填写 Microsoft Translator API 密钥。', 'auth');
  const endpoint = credentials.endpoint.replace(/\/$/, '');
  const query = new URLSearchParams({ 'api-version': '3.0', to: toMicrosoftLanguage(target) });
  if (source !== 'auto') query.set('from', toMicrosoftLanguage(source));
  const url = `${endpoint}/translate?${query.toString()}`;
  const headers: Record<string, string> = {
    'Ocp-Apim-Subscription-Key': credentials.apiKey,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-ClientTraceId': randomUUID()
  };
  if (credentials.region) headers['Ocp-Apim-Subscription-Region'] = credentials.region;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify([{ Text: text }]), signal });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new TranslationError('密钥、区域或服务端点不正确，请检查设置。', 'auth');
    if (response.status === 429) throw new TranslationError('翻译额度或请求频率已达到限制，请稍后重试。', 'quota');
    throw new TranslationError(`翻译服务暂时不可用（错误 ${response.status}）。`, 'service');
  }
  const data = await response.json() as Array<{
    detectedLanguage?: { language?: string };
    translations?: Array<{ text?: string }>;
  }>;
  const translated = data[0]?.translations?.[0]?.text?.trim();
  if (!translated) throw new TranslationError('翻译服务没有返回有效内容。', 'service');
  return {
    text: translated,
    detectedSourceLanguage: source === 'auto'
      ? normalizeProviderLanguage(data[0]?.detectedLanguage?.language)
      : source
  };
}

const baiduLanguageCodes: Record<LanguageCode, string> = {
  'zh-Hans': 'zh',
  'zh-Hant': 'cht',
  en: 'en',
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  de: 'de',
  es: 'spa',
  pt: 'pt',
  ru: 'ru'
};

const microsoftLanguageCodes: Record<LanguageCode, string> = {
  'zh-Hans': 'zh-Hans',
  'zh-Hant': 'zh-Hant',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  pt: 'pt',
  ru: 'ru'
};

const providerLanguageCodes: Record<string, LanguageCode> = {
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  cht: 'zh-Hant',
  'zh-tw': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  en: 'en',
  jp: 'ja',
  ja: 'ja',
  kor: 'ko',
  ko: 'ko',
  fra: 'fr',
  fr: 'fr',
  de: 'de',
  spa: 'es',
  es: 'es',
  pt: 'pt',
  ru: 'ru'
};

export function toBaiduLanguage(language: LanguageCode): string {
  return baiduLanguageCodes[language];
}

export function toMicrosoftLanguage(language: LanguageCode): string {
  return microsoftLanguageCodes[language];
}

export function normalizeProviderLanguage(language: string | undefined): SourceLanguageCode {
  return language ? providerLanguageCodes[language.toLowerCase()] ?? 'auto' : 'auto';
}
