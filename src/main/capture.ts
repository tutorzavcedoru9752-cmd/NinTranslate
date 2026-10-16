import { BrowserWindow, protocol, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import type { CapturePayload } from '../shared/types';
import { ScreenGrabber, type ScreenFrame } from './screenCapture';

export function registerCaptureScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'nin-capture', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

export interface CaptureTiming { totalMs: number; grabMs: number; prepareMs: number; backend: string }
interface OverlayWindow {
  win: BrowserWindow;
  loaded: Promise<void>;
  mounted: () => void;
  reject: (error: Error) => void;
  prepared?: { sessionId: string; resolve: () => void };
}
interface CaptureOptions {
  grabber?: ScreenGrabber;
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow;
  pageUrl: (route: string) => string;
  onTiming?: (timing: CaptureTiming) => void;
}

export class CaptureController {
  get isActive(): boolean { return this.busy || Boolean(this.active); }
  private overlays = new Map<string, OverlayWindow>();
  private payloads = new Map<number, CapturePayload>();
  private frames = new Map<string, ScreenFrame>();
  private grabber: ScreenGrabber;
  private busy = false;
  private active?: string;
  private generation = 0;
  private disposed = false;

  constructor(private options: CaptureOptions) {
    this.grabber = options.grabber ?? new ScreenGrabber();
    protocol.handle('nin-capture', request => {
      const token = new URL(request.url).pathname.slice(1);
      const frame = this.frames.get(token);
      if (!frame) return new Response(null, { status: 404 });
      const headers: Record<string, string> = { 'Content-Type': 'image/bmp', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
      return new Response(frame.bitmap as unknown as BodyInit, { headers });
    });
  }

  private ensureWindow(display: Electron.Display): OverlayWindow {
    const key = String(display.id);
    const existing = this.overlays.get(key);
    if (existing && !existing.win.isDestroyed()) {
      const bounds = existing.win.getBounds();
      if (Object.keys(display.bounds).some(k => bounds[k as keyof typeof bounds] !== display.bounds[k as keyof typeof bounds])) {
        existing.win.setBounds(display.bounds);
      }
      return existing;
    }
    const win = this.options.createWindow({
      ...display.bounds, frame: false, transparent: false, backgroundColor: '#181b22',
      resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, show: false,
      webPreferences: { backgroundThrottling: false }
    });
    const webContentsId = win.webContents.id;
    let mounted!: () => void;
    let reject!: (error: Error) => void;
    const loaded = new Promise<void>((resolve, fail) => { mounted = resolve; reject = fail; });
    const timer = setTimeout(() => reject(new Error('截图窗口准备超时，请重试。')), 8000);
    void loaded.then(() => clearTimeout(timer), () => { clearTimeout(timer); if (!win.isDestroyed()) win.destroy(); });
    const overlay: OverlayWindow = { win, loaded, mounted, reject };
    this.overlays.set(key, overlay);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('closed', () => {
      if (this.overlays.get(key) === overlay) this.overlays.delete(key);
      this.payloads.delete(webContentsId);
      reject(new Error('截图窗口已关闭。'));
      if (this.active) this.cancel();
    });
    win.webContents.on('render-process-gone', () => { if (!win.isDestroyed()) win.destroy(); });
    void win.loadURL(this.options.pageUrl('overlay')).catch(reject);
    return overlay;
  }

  async prewarm(): Promise<void> {
    if (this.disposed) return;
    await Promise.all([
      this.grabber.prewarm().catch(() => { /* grab() automatically falls back. */ }),
      ...screen.getAllDisplays().map(display => this.ensureWindow(display).loaded)
    ]);
  }

  getPayload(senderId: number): CapturePayload | null { return this.payloads.get(senderId) ?? null; }

  rendererReady(senderId: number, sessionId: unknown): void {
    const overlay = [...this.overlays.values()].find(item => !item.win.isDestroyed() && item.win.webContents.id === senderId);
    if (!overlay) return;
    if (sessionId === null) overlay.mounted();
    else if (typeof sessionId === 'string' && overlay.prepared?.sessionId === sessionId && this.active === sessionId) overlay.prepared.resolve();
  }

  async start(): Promise<void> {
    // Repeated shortcut/tray/IPC activation must never capture our own overlay.
    if (this.busy || this.active || this.disposed) return;
    this.busy = true;
    const generation = ++this.generation;
    const started = performance.now();
    try {
      const displays = screen.getAllDisplays();
      if (!displays.length) throw new Error('没有可用的显示器。');
      const overlays = displays.map(display => this.ensureWindow(display));
      const grabStarted = performance.now();
      const handles = process.platform === 'win32' ? overlays.map(o => o.win.getNativeWindowHandle()) : [];
      const grabbing = this.grabber.grab(displays, handles).then(result => ({ ...result, elapsed: performance.now() - grabStarted }));
      const [, { frames, backend, elapsed: grabMs }] = await Promise.all([Promise.all(overlays.map(o => o.loaded)), grabbing]);
      if (generation !== this.generation || this.disposed) return;
      const sessionId = this.active = randomUUID();
      const prepareStarted = performance.now();
      await Promise.all(displays.map((display, index) => {
        const overlay = overlays[index];
        const frame = frames.find(item => item.displayId === String(display.id));
        if (!frame) throw new Error('部分显示器未取得截图，请重试。');
        const token = randomUUID();
        this.frames.set(token, frame);
        const payload: CapturePayload = { sessionId, displayId: String(display.id), imageDataUrl: `nin-capture://frame/${token}`,
          bounds: display.bounds, scaleFactor: display.scaleFactor };
        this.payloads.set(overlay.win.webContents.id, payload);
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('截图画面加载超时，请重试。')), 5000);
          overlay.prepared = { sessionId, resolve: () => { clearTimeout(timer); resolve(); } };
          overlay.win.webContents.send('capture:prepare', payload);
        });
      }));
      if (generation !== this.generation || this.disposed) return;
      for (const overlay of overlays) if (!overlay.win.isDestroyed()) overlay.win.showInactive();
      const pointerDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      (this.overlays.get(String(pointerDisplay.id)) ?? overlays[0]).win.focus();
      this.options.onTiming?.({ totalMs: performance.now() - started, grabMs, prepareMs: performance.now() - prepareStarted, backend });
    } catch (error) {
      this.cancel();
      throw error;
    } finally { this.busy = false; }
  }

  accepts(senderId: number, sessionId: unknown): boolean {
    return typeof sessionId === 'string' && sessionId === this.active && this.payloads.get(senderId)?.sessionId === sessionId;
  }

  cancel(): void {
    ++this.generation;
    this.active = undefined;
    for (const overlay of this.overlays.values()) {
      overlay.prepared?.resolve(); overlay.prepared = undefined;
      if (!overlay.win.isDestroyed()) { overlay.win.hide(); overlay.win.webContents.send('capture:reset'); }
    }
    this.payloads.clear(); this.frames.clear();
  }

  displayChanged(prewarm = true): void {
    this.cancel();
    const current = new Set(screen.getAllDisplays().map(display => String(display.id)));
    for (const [id, overlay] of this.overlays) if (!current.has(id) && !overlay.win.isDestroyed()) overlay.win.destroy();
    if (prewarm) void this.prewarm().catch(error => console.warn('Unable to prewarm screenshot windows.', error));
  }

  dispose(): void {
    this.disposed = true; this.cancel(); this.grabber.dispose();
    for (const overlay of this.overlays.values()) if (!overlay.win.isDestroyed()) overlay.win.destroy();
    this.overlays.clear(); protocol.unhandle('nin-capture');
  }
}
