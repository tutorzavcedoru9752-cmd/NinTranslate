import type { RecognitionMode } from './types';

export const RECOGNITION_MODES: ReadonlyArray<{
  code: RecognitionMode;
  label: string;
  description: string;
}> = [
  {
    code: 'zh-en-fast',
    label: '中英快速（推荐）',
    description: '只运行中英模型，适合日常中英文截图'
  },
  {
    code: 'multilingual',
    label: '多语言自动识别',
    description: '支持十种语言，会调用更多本地模型'
  }
];

const recognitionModes = new Set<RecognitionMode>(RECOGNITION_MODES.map(({ code }) => code));

export function isRecognitionMode(value: unknown): value is RecognitionMode {
  return typeof value === 'string' && recognitionModes.has(value as RecognitionMode);
}

export function recognitionModeLabel(mode: RecognitionMode): string {
  return RECOGNITION_MODES.find(({ code }) => code === mode)?.label ?? '中英快速';
}
