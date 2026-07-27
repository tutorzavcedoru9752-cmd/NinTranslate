import { afterEach, describe, expect, it, vi } from 'vitest';
import { runConnectionTest } from './connectionTest';

afterEach(() => {
  vi.useRealTimers();
});

describe('runConnectionTest', () => {
  it('returns a successful IPC result', async () => {
    await expect(runConnectionTest(async () => ({ ok: true, message: '连接成功' }))).resolves.toEqual({
      ok: true,
      message: '连接成功'
    });
  });

  it('turns an IPC rejection into a visible error', async () => {
    await expect(runConnectionTest(async () => {
      throw new Error('IPC unavailable');
    })).resolves.toEqual({ ok: false, message: 'IPC unavailable' });
  });

  it('stops waiting when IPC never responds', async () => {
    vi.useFakeTimers();
    const pending = runConnectionTest(() => new Promise(() => undefined), 20);
    await vi.advanceTimersByTimeAsync(21);
    await expect(pending).resolves.toMatchObject({ ok: false });
  });
});
