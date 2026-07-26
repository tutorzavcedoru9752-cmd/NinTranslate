export interface WindowSize {
  width: number;
  height: number;
}

export function clampResultWindowSize(width: number, height: number, workArea: WindowSize): WindowSize {
  return {
    width: Math.max(360, Math.min(Math.round(width), workArea.width)),
    height: Math.max(320, Math.min(Math.round(height), workArea.height))
  };
}
