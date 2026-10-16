// Idle/cold compositor benchmark. No screen image is written to disk.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const label = process.argv[2] || 'current';
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, label], { env, cwd: root, windowsHide: true, stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  const { app, BrowserWindow, ipcMain, screen } = require('electron');
  const { CaptureController, registerCaptureScheme } = require('../dist-electron/main/capture.js');
  const { ScreenGrabber } = require('../dist-electron/main/screenCapture.js');
  registerCaptureScheme();
  app.setPath('userData', path.join(root, 'output', `capture-idle-profile-${Date.now()}`));
  app.on('window-all-closed', () => {});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const gaps = JSON.parse(process.env.NINTRANSLATE_CAPTURE_GAPS_MS || '[0,15000,30000,60000,120000]');
  app.whenReady().then(async () => {
    let controller;
    const overlays = [], timings = [], samples = [];
    try {
      controller = new CaptureController({
        grabber: new ScreenGrabber(path.join(root, 'resources', 'capture', 'win32-x64', 'screen-capture.exe')),
        createWindow: options => {
          const win = new BrowserWindow({ ...options, webPreferences: { preload: path.join(root, 'dist-electron', 'preload', 'index.js'),
            contextIsolation: true, sandbox: false, nodeIntegration: false, ...options.webPreferences } });
          overlays.push(win); return win;
        },
        pageUrl: () => pathToFileURL(path.join(root, 'dist', 'index.html')).href + '#/overlay',
        onTiming: timing => timings.push(timing)
      });
      ipcMain.handle('capture:get-payload', event => controller.getPayload(event.sender.id));
      ipcMain.handle('capture:ready', (event, id) => controller.rendererReady(event.sender.id, id));
      ipcMain.handle('capture:presented', (event, id) => controller.rendererPresented?.(event.sender.id, id));
      ipcMain.handle('capture:cancel', () => controller.cancel());
      await controller.prewarm();
      for (const gapMs of gaps) {
        console.log(JSON.stringify({ label, waitingMs: gapMs }));
        await sleep(gapMs);
        const start = performance.now();
        await controller.start();
        if (!overlays.every(win => win.isVisible())) throw new Error('Capture did not show');
        // capturePage resolves after the compositor has actually produced pixels;
        // it includes a readback copy, so this is an upper bound, not photon timing.
        await Promise.all(overlays.map(win => win.webContents.capturePage()));
        const sample = { gapMs, ...timings.at(-1), visibleReadbackMs: performance.now() - start };
        samples.push(sample); console.log(JSON.stringify({ label, ...sample }));
        await sleep(500); controller.cancel();
      }
      const report = { label, electron: process.versions.electron,
        displays: screen.getAllDisplays().map(d => ({ size: d.size, scaleFactor: d.scaleFactor })), samples };
      fs.mkdirSync(path.join(root, 'output'), { recursive: true });
      fs.writeFileSync(path.join(root, 'output', `capture-idle-${label}.json`), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { controller?.dispose(); for (const win of overlays) if (!win.isDestroyed()) win.destroy(); app.exit(process.exitCode || 0); }
  });
}
