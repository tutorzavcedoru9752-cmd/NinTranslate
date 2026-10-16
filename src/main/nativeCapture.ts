import { app, screen } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CaptureSelection } from '../shared/types';

export interface NativeCaptureTiming {
  backend: 'native-overlay'; totalMs: number; nativeGrabMs: number; nativeTotalMs: number;
}
interface NativeMessage {
  type: 'ready' | 'warmed' | 'shown' | 'selected' | 'canceled' | 'error';
  id?: string; imageDataUrl?: string; bounds?: Electron.Rectangle;
  nativeGrabMs?: number; nativeTotalMs?: number; message?: string;
}
interface Options {
  executable?: string;
  onSelection: (selection: CaptureSelection) => void | Promise<void>;
  onTiming?: (timing: NativeCaptureTiming) => void;
  onFailure?: (error: Error) => void;
}

export class NativeCaptureController {
  get isActive(): boolean { return Boolean(this.active); }
  private child?: ChildProcessWithoutNullStreams;
  private startup?: Promise<void>;
  private buffer = '';
  private active?: { id: string; started: number; shown: boolean; resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private warms = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private restartTimer?: NodeJS.Timeout;
  private disposed = false;
  private failures = 0;

  constructor(private options: Options) {}

  private displayDescription(): string {
    const displays = screen.getAllDisplays();
    if (!displays.length) throw new Error('没有可用的显示器。');
    return displays.map(display => {
      const bounds = screen.dipToScreenRect(null, display.bounds);
      return [bounds.x, bounds.y, bounds.width, bounds.height, display.scaleFactor].join(',');
    }).join(';');
  }

  private launch(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('截图组件已停止。'));
    if (this.startup) return this.startup;
    clearTimeout(this.restartTimer);
    const executable = this.options.executable ?? (app.isPackaged
      ? path.join(process.resourcesPath, 'capture', 'win32-x64', 'screen-overlay.exe')
      : path.join(app.getAppPath(), 'resources', 'capture', 'win32-x64', 'screen-overlay.exe'));
    this.startup = new Promise<void>((resolve, reject) => {
      const child = this.child = spawn(executable, [], { stdio: 'pipe', windowsHide: true });
      let ready = false, failed = false;
      const timer = setTimeout(() => fail(new Error('原生截图组件启动超时。')), 3000);
      const fail = (error: Error) => {
        if (failed || this.child !== child) return;
        failed = true; clearTimeout(timer); reject(error);
        this.child = undefined; this.startup = undefined; this.buffer = '';
        if (this.active) { clearTimeout(this.active.timer); this.active.reject(error); this.active = undefined; }
        for (const warm of this.warms.values()) { clearTimeout(warm.timer); warm.reject(error); }
        this.warms.clear(); child.kill();
        if (!this.disposed) {
          this.options.onFailure?.(error);
          const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6));
          this.restartTimer = setTimeout(() => { void this.prewarm().catch(() => {}); }, delay);
          this.restartTimer.unref();
        }
      };
      child.on('error', fail); child.on('exit', () => fail(new Error('原生截图组件意外退出。')));
      child.stdin.on('error', fail);
      child.stderr.on('data', () => { /* Screen content never enters diagnostic logs. */ });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (failed) return;
        this.buffer += chunk;
        if (this.buffer.length > 128_000_000) { fail(new Error('截图选区过大。')); return; }
        let index: number;
        while ((index = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
          let message: NativeMessage;
          try { message = JSON.parse(line) as NativeMessage; } catch { fail(new Error('原生截图组件通信异常。')); return; }
          if (message.type === 'ready' && !ready) { ready = true; clearTimeout(timer); this.failures = 0; resolve(); }
          else this.receive(message);
        }
      });
    });
    return this.startup;
  }

  private receive(message: NativeMessage): void {
    if (message.type === 'warmed' && message.id) {
      const warm = this.warms.get(message.id);
      if (warm) { this.warms.delete(message.id); clearTimeout(warm.timer); warm.resolve(); }
      return;
    }
    const active = this.active;
    if (!active || message.id !== active.id) return;
    if (message.type === 'shown') {
      if (active.shown) return;
      active.shown = true; clearTimeout(active.timer);
      this.options.onTiming?.({ backend: 'native-overlay', totalMs: performance.now() - active.started,
        nativeGrabMs: message.nativeGrabMs ?? 0, nativeTotalMs: message.nativeTotalMs ?? 0 });
      active.resolve();
    } else if (message.type === 'canceled') {
      clearTimeout(active.timer); active.resolve(); this.active = undefined;
    } else if (message.type === 'selected') {
      const bounds = message.bounds;
      const validBounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
      if (!validBounds || typeof message.imageDataUrl !== 'string' || !message.imageDataUrl.startsWith('data:image/png;base64,')) {
        this.cancel(); this.options.onFailure?.(new Error('原生截图选区数据无效。')); return;
      }
      clearTimeout(active.timer); active.resolve(); this.active = undefined;
      const screenBounds = screen.screenToDipRect(null, bounds);
      void Promise.resolve(this.options.onSelection({ sessionId: active.id, imageDataUrl: message.imageDataUrl, screenBounds }))
        .catch(error => this.options.onFailure?.(error instanceof Error ? error : new Error('截图处理失败。')));
    } else if (message.type === 'error') {
      clearTimeout(active.timer); this.active = undefined;
      const error = new Error(message.message || '原生截图失败。'); active.reject(error); this.options.onFailure?.(error);
    }
  }

  async prewarm(): Promise<void> {
    await this.launch();
    if (this.active) return;
    const description = this.displayDescription();
    const id = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.warms.delete(id); reject(new Error('原生截图窗口准备超时。')); this.restart(); }, 2000);
      this.warms.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`warm|${id}|${description}\n`);
    });
  }

  async start(): Promise<void> {
    if (this.active || this.disposed) return;
    const started = performance.now();
    // Set the gate before awaiting helper startup to coalesce concurrent triggers.
    let resolveShown!: () => void, rejectShown!: (error: Error) => void;
    const shown = new Promise<void>((resolve, reject) => { resolveShown = resolve; rejectShown = reject; });
    const active = { id: randomUUID(), started, shown: false, resolve: resolveShown, reject: rejectShown,
      timer: setTimeout(() => { rejectShown(new Error('原生截图显示超时。')); this.restart(); }, 2000) };
    this.active = active;
    // Attach a rejection handler now; launch may itself reject first.
    void shown.catch(() => {});
    try {
      await this.launch();
      if (this.active !== active || this.disposed) return;
      this.child!.stdin.write(`select|${active.id}|${this.displayDescription()}\n`);
      await shown;
    } catch (error) {
      clearTimeout(active.timer); if (this.active === active) this.active = undefined;
      throw error;
    }
  }

  cancel(): void {
    const active = this.active; this.active = undefined;
    if (!active) return;
    clearTimeout(active.timer); active.resolve();
    if (this.child && !this.child.killed) this.child.stdin.write(`cancel|${active.id}\n`);
  }

  restart(): void {
    this.cancel(); this.child?.kill(); this.startup = undefined;
  }

  displayChanged(): void { this.cancel(); void this.prewarm().catch(() => {}); }

  dispose(): void {
    this.disposed = true; clearTimeout(this.restartTimer); this.cancel();
    for (const warm of this.warms.values()) { clearTimeout(warm.timer); warm.reject(new Error('截图组件已停止。')); }
    this.warms.clear(); this.child?.stdin.end(); this.child?.kill(); this.child = undefined;
  }
}
