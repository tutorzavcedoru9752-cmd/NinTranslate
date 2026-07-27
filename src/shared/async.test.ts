import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './async';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('returns a completed value', async () => {
    await expect(withTimeout(Promise.resolve('done'), 100, 'late')).resolves.toBe('done');
  });

  it('rejects an operation that never settles', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<string>(() => undefined), 20, 'timed out');
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
  });
});
