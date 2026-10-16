import { app, desktopCapturer, screen } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

export interface ScreenFrame { displayId: string; bitmap: Buffer }

// A 32-bit top-down BMP avoids full-screen PNG compression and base64 encoding.
export function bitmapFile(pixels: Buffer, width: number, height: number): Buffer {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) throw new Error('Invalid screen bitmap');
  const header = Buffer.alloc(54);
  header.write('BM'); header.writeUInt32LE(54 + pixels.length, 2); header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14); header.writeInt32LE(width, 18); header.writeInt32LE(-height, 22);
  header.writeUInt16LE(1, 26); header.writeUInt16LE(32, 28); header.writeUInt32LE(pixels.length, 34);
  return Buffer.concat([header, pixels]);
}

export class ScreenGrabber {
  constructor(private executable?: string) {}
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending?: { expected: number; frames: Buffer[]; resolve: (frames: Buffer[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private chunks: Buffer[] = [];
  private buffered = 0;
  private frameLength = 0;
  private retryAfter = 0;

  prewarm(): Promise<void> {
    if (process.platform !== 'win32' || Date.now() < this.retryAfter) return Promise.resolve();
    if (this.ready) return this.ready;
    const executable = this.executable ?? (app.isPackaged
      ? path.join(process.resourcesPath, 'capture', 'win32-x64', 'screen-capture.exe')
      : path.join(app.getAppPath(), 'resources', 'capture', 'win32-x64', 'screen-capture.exe'));
    this.ready = new Promise<void>((resolve, reject) => {
      const child = this.child = spawn(executable, [], { windowsHide: true, stdio: 'pipe' });
      const timeout = setTimeout(() => fail(new Error('Native capture startup timed out')), 3000);
      let initialized = false;
      const fail = (error: Error) => {
        if (this.child !== child) return;
        clearTimeout(timeout);
        this.retryAfter = Date.now() + 5000;
        this.child = undefined; this.ready = undefined;
        this.rejectPending(error);
        reject(error);
        child.kill();
      };
      child.on('error', fail);
      child.on('exit', () => fail(new Error('Native capture helper exited')));
      child.stdin.on('error', fail);
      child.stderr.on('data', () => { /* Do not log screen content or commands. */ });
      child.stdout.on('data', (chunk: Buffer) => {
        this.chunks.push(chunk); this.buffered += chunk.length;
        if (!initialized && this.buffered >= 4) {
          if (this.take(4).readUInt32LE() !== 0x434e494e) { fail(new Error('Invalid native capture handshake')); return; }
          initialized = true; clearTimeout(timeout); resolve();
        }
        while (initialized && this.pending) {
          if (!this.frameLength) {
            if (this.buffered < 4) break;
            this.frameLength = this.take(4).readInt32LE();
            if (this.frameLength < 54 || this.frameLength > 256_000_054) { fail(new Error('Native screen capture failed')); break; }
          }
          if (this.buffered < this.frameLength) break;
          this.pending.frames.push(this.take(this.frameLength)); this.frameLength = 0;
          if (this.pending.frames.length === this.pending.expected) {
            const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.resolve(pending.frames);
          }
        }
      });
    });
    return this.ready;
  }

  private take(length: number): Buffer {
    // Coalesce only once per complete frame, not for every stdout chunk (quadratic copies).
    const result = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.chunks[0];
      const size = Math.min(length - offset, chunk.length);
      chunk.copy(result, offset, 0, size); offset += size;
      if (size === chunk.length) this.chunks.shift(); else this.chunks[0] = chunk.subarray(size);
    }
    this.buffered -= length;
    return result;
  }

  private rejectPending(error: Error): void {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.chunks = []; this.buffered = 0; this.frameLength = 0;
  }

  async grab(displays: Electron.Display[], overlayHandles: Buffer[] = []): Promise<{ frames: ScreenFrame[]; backend: 'native' | 'electron' }> {
    if (process.platform === 'win32' && Date.now() >= this.retryAfter) {
      try {
        await this.prewarm();
        const frames = await new Promise<Buffer[]>((resolve, reject) => {
          const timer = setTimeout(() => { this.retryAfter = Date.now() + 5000; this.rejectPending(new Error('Native screen capture timed out')); this.child?.kill(); this.ready = undefined; }, 1500);
          this.pending = { expected: displays.length, frames: [], resolve, reject, timer };
          const command = displays.map(display => {
            const bounds = screen.dipToScreenRect(null, display.bounds);
            return [bounds.x, bounds.y, bounds.width, bounds.height].join(',');
          }).join(';');
          const handles = overlayHandles.map(handle => handle.readBigUInt64LE().toString()).join(',');
          this.child!.stdin.write(handles + '|' + command + '\n');
        });
        return { frames: frames.map((bitmap, index) => ({ displayId: String(displays[index].id), bitmap })), backend: 'native' };
      } catch { console.warn('Native screen capture unavailable; using Electron screen capture.'); }
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: {
      width: Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor))),
      height: Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor)))
    } });
    const frames = displays.map((display, index) => {
      const source = sources.find(s => s.display_id === String(display.id)) ?? sources[index];
      if (!source || source.thumbnail.isEmpty()) throw new Error('没有取得可用的屏幕画面，请检查屏幕录制权限。');
      const { width, height } = source.thumbnail.getSize();
      return { displayId: String(display.id), bitmap: bitmapFile(source.thumbnail.toBitmap(), width, height) };
    });
    return { frames, backend: 'electron' };
  }

  dispose(): void {
    this.retryAfter = Infinity;
    this.rejectPending(new Error('Screen capture stopped'));
    this.child?.stdin.end(); this.child?.kill(); this.child = undefined;
  }
}
