import { describe, expect, it } from 'vitest';
import { RequestVersionTracker } from './requestVersion';

describe('RequestVersionTracker', () => {
  it('accepts only the newest translation response', () => {
    const tracker = new RequestVersionTracker();
    const first = tracker.next('result-1');
    const second = tracker.next('result-1');
    expect(tracker.isLatest('result-1', first)).toBe(false);
    expect(tracker.isLatest('result-1', second)).toBe(true);
  });

  it('forgets versions when a result window closes', () => {
    const tracker = new RequestVersionTracker();
    const version = tracker.next('result-1');
    tracker.delete('result-1');
    expect(tracker.isLatest('result-1', version)).toBe(false);
  });
});
