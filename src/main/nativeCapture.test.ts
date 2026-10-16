import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fakes = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: fakes.spawn }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => 'C:/test' }, screen: {
  getAllDisplays: () => [{ id: 1, bounds: { x: -800, y: 0, width: 800, height: 600 }, scaleFactor: 1.25 }],
  dipToScreenRect: (_window: unknown, bounds: unknown) => bounds,
  screenToDipRect: (_window: unknown, bounds: { x:number; y:number; width:number; height:number }) => ({ ...bounds, x: bounds.x / 1.25 })
} }));
import { NativeCaptureController } from './nativeCapture';

class Helper extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stderr = new EventEmitter();
  killed = false;
  autoShown = true;
  lastId = '';
  stdin = Object.assign(new EventEmitter(), { end: vi.fn(), write: vi.fn((command: string) => {
    const [type, id] = command.trim().split('|');
    if (type === 'warm') queueMicrotask(() => this.send({ type: 'warmed', id }));
    if (type === 'select') { this.lastId = id; if(this.autoShown) queueMicrotask(() => this.send({ type: 'shown', id, nativeGrabMs: 10, nativeTotalMs: 20 })); }
    if (type === 'cancel') queueMicrotask(() => this.send({ type: 'canceled', id }));
  }) });
  kill = vi.fn(() => { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); });
  send(message: object) { this.stdout.emit('data', JSON.stringify(message) + '\n'); }
}
let helpers: Helper[], controller: NativeCaptureController;
let onSelection: ReturnType<typeof vi.fn>, onTiming: ReturnType<typeof vi.fn>, onFailure: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); helpers = [];
  fakes.spawn.mockImplementation(() => {
    const helper = new Helper(); helpers.push(helper); queueMicrotask(() => helper.send({ type:'ready' })); return helper;
  });
  onSelection = vi.fn(); onTiming = vi.fn(); onFailure = vi.fn();
  controller = new NativeCaptureController({ onSelection, onTiming, onFailure });
});
afterEach(() => { controller.dispose(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('native screenshot lifecycle', () => {
  it('warms without capturing screen pixels, then coalesces repeated activations', async () => {
    await controller.prewarm();
    expect(helpers[0].stdin.write.mock.calls.every(([line]) => line.startsWith('warm|'))).toBe(true);
    await Promise.all([controller.start(), controller.start(), controller.start()]);
    expect(helpers[0].stdin.write.mock.calls.filter(([line]) => line.startsWith('select|'))).toHaveLength(1);
    expect(onTiming).toHaveBeenCalledOnce();
    expect(onTiming.mock.calls[0][0].backend).toBe('native-overlay');
  });
  it('accepts only the latest native session and converts physical selection bounds', async () => {
    await controller.prewarm(); await controller.start();
    const id = helpers[0].lastId;
    controller.cancel(); await controller.start();
    helpers[0].send({ type:'selected', id, imageDataUrl:'data:image/png;base64,AA==', bounds:{x:-500,y:1,width:40,height:50} });
    expect(onSelection).not.toHaveBeenCalled();
    helpers[0].send({ type:'selected', id: helpers[0].lastId, imageDataUrl:'data:image/png;base64,AA==', bounds:{x:-500,y:1,width:40,height:50} });
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({screenBounds:{x:-400,y:1,width:40,height:50}}));
  });
  it('recovers a helper crash without permanently falling back for the remaining app session', async () => {
    await controller.prewarm(); await controller.start();
    helpers[0].emit('exit', 1);
    expect(onFailure).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1001);
    expect(helpers).toHaveLength(2);
    await controller.start(); expect(onTiming).toHaveBeenCalledTimes(2);
  });
  it('bounds a stuck native show request, closes it and permits the next capture', async () => {
    await controller.prewarm(); helpers[0].autoShown = false;
    const request = controller.start();
    const rejected = expect(request).rejects.toThrow('原生截图显示超时');
    await vi.advanceTimersByTimeAsync(2001); await rejected;
    expect(helpers[0].kill).toHaveBeenCalled();
    await controller.prewarm(); await controller.start();
    expect(onTiming).toHaveBeenCalledOnce();
  });
  it('cancels during asynchronous startup without opening an obsolete selection session', async () => {
    const starting = controller.start(); controller.cancel(); await starting;
    expect(helpers[0].stdin.write.mock.calls.some(([line]) => line.startsWith('select|'))).toBe(false);
  });
  it('rejects invalid crop payloads and never invokes the OCR callback', async () => {
    await controller.prewarm(); await controller.start();
    helpers[0].send({ type:'selected', id:helpers[0].lastId, imageDataUrl:'file:///private.png', bounds:{x:0,y:0,width:-1,height:1} });
    expect(onSelection).not.toHaveBeenCalled(); expect(onFailure).toHaveBeenCalledOnce();
  });
});
