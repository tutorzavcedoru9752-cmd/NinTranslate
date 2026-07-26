import { describe, expect, it } from 'vitest';
import { clampResultWindowSize } from './windowSize';

describe('clampResultWindowSize', () => {
  it('keeps a normal requested size', () => {
    expect(clampResultWindowSize(640, 520, { width: 1920, height: 1040 })).toEqual({ width: 640, height: 520 });
  });

  it('enforces the minimum result-window size', () => {
    expect(clampResultWindowSize(120, 100, { width: 1920, height: 1040 })).toEqual({ width: 360, height: 320 });
  });

  it('does not grow beyond the current display work area', () => {
    expect(clampResultWindowSize(3000, 2000, { width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
  });
});
