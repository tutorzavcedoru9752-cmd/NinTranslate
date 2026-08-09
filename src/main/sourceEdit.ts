import type { ResultState } from '../shared/types';

export function normalizeEditedSource(value: unknown): string {
  if (typeof value !== 'string') throw new Error('编辑后的原文格式无效。');
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .trim();
  if (!normalized) throw new Error('原文不能为空，请输入需要翻译的文字。');
  return normalized;
}

export function prepareEditedResult(state: ResultState, value: unknown): ResultState {
  return {
    ...state,
    sourceText: normalizeEditedSource(value),
    sourceLanguage: 'auto',
    translatedText: '',
    sourceEdited: true,
    status: 'translating',
    message: '原文已修改，正在重新检测语言并翻译…'
  };
}
