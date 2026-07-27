import type { TestTranslationResult } from '../shared/types';
import { withTimeout } from '../shared/async';

export async function runConnectionTest(
  invoke: () => Promise<TestTranslationResult>,
  timeoutMs = 20000
): Promise<TestTranslationResult> {
  try {
    return await withTimeout(
      Promise.resolve().then(invoke),
      timeoutMs,
      '连接测试超过 20 秒仍未完成。请完全退出应用后重试；如果问题持续存在，请检查系统钥匙串。'
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '连接测试失败，请重新启动应用后重试。'
    };
  }
}
