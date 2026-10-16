import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturePayload } from '../shared/types';

const fake = vi.hoisted(() => ({
  displays: [{ id: 1, bounds: { x: -800, y: 0, width: 800, height: 600 }, scaleFactor: 1 }],
  protocol: { handle: vi.fn(), unhandle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }
}));
vi.mock('electron', () => ({ protocol: fake.protocol, screen: {
  getAllDisplays: () => fake.displays, getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => fake.displays[0]
} }));
import { CaptureController } from './capture';
import { bitmapFile, type ScreenGrabber } from './screenCapture';

class FakeWindow extends EventEmitter {
  destroyed = false;
  bounds = { x: -800, y: 0, width: 800, height: 600 };
  showInactive = vi.fn(); hide = vi.fn(); focus = vi.fn();
  setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn();
  webContents = Object.assign(new EventEmitter(), { id: Math.random(), send: vi.fn() });
  isDestroyed() { return this.destroyed; }
  getBounds() { return this.bounds; }
  getNativeWindowHandle() { return Buffer.alloc(8); }
  setBounds(bounds: typeof this.bounds) { this.bounds = bounds; }
  loadURL = vi.fn(async () => { controller.rendererReady(this.webContents.id, null); });
  destroy() { this.destroyed = true; this.emit('closed'); }
}
let controller: CaptureController;
let windows: FakeWindow[];
const bitmap = bitmapFile(Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]), 2, 1);
let grab: ReturnType<typeof vi.fn>;
let autoReady = true;
beforeEach(() => {
  fake.displays = [{ id: 1, bounds: { x: -800, y: 0, width: 800, height: 600 }, scaleFactor: 1 }];
  windows = []; autoReady = true;
  grab = vi.fn(async () => ({ frames: fake.displays.map(d => ({ displayId: String(d.id), bitmap })), backend: 'native' }));
  controller = new CaptureController({
    grabber: { grab, prewarm: vi.fn(async () => {}), dispose: vi.fn() } as unknown as ScreenGrabber,
    pageUrl: () => 'file:///overlay',
    createWindow: () => {
      const win = new FakeWindow(); windows.push(win);
      win.webContents.send.mockImplementation((channel: string, payload: CapturePayload) => {
        if (channel === 'capture:prepare' && autoReady) controller.rendererReady(win.webContents.id, payload.sessionId);
      });
      return win as never;
    }
  });
});
afterEach(() => { controller.dispose(); vi.clearAllMocks(); });

describe('pooled screenshot lifecycle', () => {
  it('reuses warmed windows, refreshes frames, and releases canceled image URLs', async () => {
    await controller.prewarm();
    await controller.start();
    const first = controller.getPayload(windows[0].webContents.id)!;
    expect(controller.accepts(windows[0].webContents.id, first.sessionId)).toBe(true);
    const handler = fake.protocol.handle.mock.calls.at(-1)![1];
    expect((handler({ url: first.imageDataUrl }) as Response).status).toBe(200);
    controller.cancel();
    expect(controller.getPayload(windows[0].webContents.id)).toBeNull();
    expect((handler({ url: first.imageDataUrl }) as Response).status).toBe(404);
    await controller.start();
    expect(windows).toHaveLength(1);
    expect(grab).toHaveBeenCalledTimes(2);
    expect(controller.getPayload(windows[0].webContents.id)?.sessionId).not.toBe(first.sessionId);
    expect(controller.accepts(windows[0].webContents.id, first.sessionId)).toBe(false);
  });

  it('coalesces repeated activation while preparing and while selecting', async () => {
    let resolve!: (value: Awaited<ReturnType<ScreenGrabber['grab']>>) => void;
    grab.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = controller.start();
    await controller.start(); await controller.start();
    expect(grab).toHaveBeenCalledTimes(1);
    resolve({ frames: [{ displayId: '1', bitmap }], backend: 'native' });
    await pending;
    await controller.start();
    expect(grab).toHaveBeenCalledTimes(1);
    expect(windows[0].showInactive).toHaveBeenCalledTimes(1);
  });

  it('never shows an outstanding capture after cancellation', async () => {
    let resolve!: (value: Awaited<ReturnType<ScreenGrabber['grab']>>) => void;
    grab.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = controller.start();
    controller.cancel();
    resolve({ frames: [{ displayId: '1', bitmap }], backend: 'native' });
    await pending;
    expect(windows[0].showInactive).not.toHaveBeenCalled();
    expect(controller.getPayload(windows[0].webContents.id)).toBeNull();
  });

  it('ignores forged or stale image-ready messages and displays only the matching session', async () => {
    autoReady = false;
    const pending = controller.start();
    await vi.waitFor(() => expect(controller.getPayload(windows[0].webContents.id)).not.toBeNull());
    const payload = controller.getPayload(windows[0].webContents.id)!;
    controller.rendererReady(windows[0].webContents.id, 'old-session');
    controller.rendererReady(-1, payload.sessionId);
    expect(windows[0].showInactive).not.toHaveBeenCalled();
    controller.rendererReady(windows[0].webContents.id, payload.sessionId);
    await pending;
    expect(windows[0].showInactive).toHaveBeenCalledOnce();
    expect(controller.accepts(-1, payload.sessionId)).toBe(false);
  });

  it('prepares monitors in parallel and refreshes changed display bounds', async () => {
    fake.displays.push({ id: 2, bounds: { x: 0, y: 0, width: 1024, height: 768 }, scaleFactor: 1 });
    await controller.prewarm();
    await controller.start();
    expect(windows).toHaveLength(2);
    expect(windows.every(w => w.showInactive.mock.calls.length === 1)).toBe(true);
    fake.displays.shift();
    fake.displays[0].bounds = { x: 0, y: 0, width: 640, height: 480 };
    controller.displayChanged();
    expect(windows[0].destroyed).toBe(true);
    expect(windows[1].bounds.width).toBe(640);
  });

  it('cleans up and allows retry after capture failure', async () => {
    grab.mockRejectedValueOnce(new Error('No screen'));
    await expect(controller.start()).rejects.toThrow('No screen');
    expect(windows[0].showInactive).not.toHaveBeenCalled();
    await controller.start();
    expect(windows[0].showInactive).toHaveBeenCalledOnce();
  });
});

describe('lossless screen bitmap transport', () => {
  it('preserves BGRA pixels and top-down dimensions without image compression', () => {
    expect(bitmap.subarray(0, 2).toString()).toBe('BM');
    expect(bitmap.readUInt32LE(2)).toBe(bitmap.length);
    expect(bitmap.readInt32LE(18)).toBe(2);
    expect(bitmap.readInt32LE(22)).toBe(-1);
    expect(bitmap.subarray(54)).toEqual(Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]));
  });
  it('rejects dimensions that do not match the supplied pixels', () => {
    expect(() => bitmapFile(Buffer.alloc(2), 2, 2)).toThrow();
  });
});
