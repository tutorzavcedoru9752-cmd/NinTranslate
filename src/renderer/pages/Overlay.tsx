import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CapturePayload } from '../../shared/types';

interface Point { x: number; y: number }
interface Rect { x: number; y: number; width: number; height: number }

function normalizedRect(start: Point, end: Point): Rect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

async function cropAndEnhance(payload: CapturePayload, rect: Rect): Promise<string> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('截图加载失败')); image.src = payload.imageDataUrl; });
  const scaleX = image.naturalWidth / window.innerWidth;
  const scaleY = image.naturalHeight / window.innerHeight;
  const sourceWidth = Math.max(1, Math.round(rect.width * scaleX));
  const sourceHeight = Math.max(1, Math.round(rect.height * scaleY));
  const enlarge = sourceWidth < 1400 ? Math.min(2, 2800 / sourceWidth) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceWidth * enlarge);
  canvas.height = Math.round(sourceHeight * enlarge);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法处理截图');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, Math.round(rect.x * scaleX), Math.round(rect.y * scaleY), sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
    const adjusted = Math.max(0, Math.min(255, (gray - 128) * 1.16 + 128));
    pixels.data[i] = adjusted; pixels.data[i + 1] = adjusted; pixels.data[i + 2] = adjusted;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

export function Overlay(): React.JSX.Element {
  const [payload, setPayload] = useState<CapturePayload | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [processing, setProcessing] = useState(false);
  const revision = useRef(0);
  const rect = start && current ? normalizedRect(start, current) : null;

  useEffect(() => {
    let disposed = false;
    const prepare = (next: CapturePayload | null) => {
      if (!next) return;
      if (disposed) return;
      ++revision.current;
      // Use the displayed <img>'s load event, not an off-screen preloader: the
      // latter causes a second fetch with no-store and can reveal a blank frame.
      flushSync(() => { setStart(null); setCurrent(null); setProcessing(false); setPayload(next); });
    };
    const stopPrepare = window.ninTranslate.capture.onPrepare(next => { void prepare(next); });
    const stopReset = window.ninTranslate.capture.onReset(() => {
      ++revision.current; setPayload(null); setStart(null); setCurrent(null); setProcessing(false);
    });
    void window.ninTranslate.capture.getPayload().then(prepare);
    void window.ninTranslate.capture.ready(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') void window.ninTranslate.capture.cancel(); };
    window.addEventListener('keydown', onKey);
    return () => { disposed = true; ++revision.current; stopPrepare(); stopReset(); window.removeEventListener('keydown', onKey); };
  }, []);

  async function finishSelection(end: Point): Promise<void> {
    const selectionRect = start ? normalizedRect(start, end) : null;
    if (processing) return;
    if (!payload || !selectionRect || selectionRect.width < 8 || selectionRect.height < 8) { setStart(null); setCurrent(null); return; }
    const version = revision.current;
    setProcessing(true);
    try {
      const imageDataUrl = await cropAndEnhance(payload, selectionRect);
      if (version !== revision.current) return;
      await window.ninTranslate.capture.complete({
        sessionId: payload.sessionId,
        imageDataUrl,
        screenBounds: { x: payload.bounds.x + selectionRect.x, y: payload.bounds.y + selectionRect.y, width: selectionRect.width, height: selectionRect.height }
      });
    } catch { if (version === revision.current) setProcessing(false); }
  }

  return (
    <div
      className="capture-root"
      role="region"
      aria-label="截图选区，拖动框选文字，按 Escape 取消"
      onContextMenu={(event) => { event.preventDefault(); void window.ninTranslate.capture.cancel(); }}
      onPointerDown={(event) => { if (payload && !processing && event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); setStart({ x: event.clientX, y: event.clientY }); setCurrent({ x: event.clientX, y: event.clientY }); } }}
      onPointerMove={(event) => { if (start && !processing) setCurrent({ x: event.clientX, y: event.clientY }); }}
      onPointerUp={(event) => { if (event.button === 0) void finishSelection({ x: event.clientX, y: event.clientY }); }}
    >
      {payload && <img key={payload.sessionId} className="capture-screen" src={payload.imageDataUrl} alt="" draggable={false}
        onLoad={() => { void window.ninTranslate.capture.ready(payload.sessionId); }}
        onError={() => { void window.ninTranslate.capture.cancel(); }} />}
      {!rect && <div className="capture-help"><strong>拖动框选要翻译的文字</strong><span>按 Esc 取消</span></div>}
      {rect && <div className="capture-selection" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}><span>{Math.round(rect.width)} × {Math.round(rect.height)}</span></div>}
      {processing && <div className="capture-processing"><span className="spinner" />正在准备识别…</div>}
    </div>
  );
}
