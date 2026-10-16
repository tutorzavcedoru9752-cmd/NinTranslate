// Run with: node scripts/benchmark-capture.cjs [baseline|optimized]
// Captures stay in memory. Only numerical measurements are written to output/.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const mode = process.argv[2] || 'baseline';
const sampleCount = Math.max(5, Number(process.env.NINTRANSLATE_CAPTURE_SAMPLES) || 20);
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, mode], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
  if (mode !== 'baseline') require('../dist-electron/main/capture.js').registerCaptureScheme();
  app.setPath('userData', path.join(root, 'output', `capture-benchmark-profile-${Date.now()}`));
  const preload = path.join(root, 'dist-electron', 'preload', 'index.js');
  const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href + '#/overlay';
  app.on('window-all-closed', () => {});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frameReady = `new Promise(async resolve => {
    for (let i = 0; i < 400; i++) {
      const element = document.querySelector('.capture-root');
      const match = element && element.style.backgroundImage.match(/url\\(["']?(.*?)["']?\\)$/);
      const shownImage = document.querySelector('.capture-screen');
      if (match || (shownImage && shownImage.complete)) {
        const image = shownImage || new Image(); if (!shownImage) image.src = match[1]; await image.decode();
        requestAnimationFrame(() => requestAnimationFrame(resolve)); return;
      }
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Overlay image did not become ready');
  })`;
  app.whenReady().then(async () => {
    let controller;
    const payloads = new Map();
    const samples = [];
    const windows = [];
    try {
      const displays = screen.getAllDisplays();
      if (mode === 'baseline') {
        ipcMain.handle('capture:get-payload', event => payloads.get(event.sender.id));
        ipcMain.handle('capture:ready', () => {});
        for (let i = 0; i < sampleCount; i++) {
          const start = performance.now();
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
            width: Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor))),
            height: Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor)))
          } });
          const grabbed = performance.now();
          let encoded = 0;
          for (const [index, display] of displays.entries()) {
            const source = sources.find(s => s.display_id === String(display.id)) || sources[index];
            if (!source) throw new Error('Missing display source');
            const beforeEncoding = performance.now();
            const imageDataUrl = source.thumbnail.toDataURL();
            encoded += performance.now() - beforeEncoding;
            const win = new BrowserWindow({ ...display.bounds, frame: false, show: false, resizable: false, skipTaskbar: true,
              webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false } });
            windows.push(win);
            payloads.set(win.webContents.id, { sessionId: `baseline-${i}`, displayId: String(display.id), bounds: display.bounds, scaleFactor: display.scaleFactor, imageDataUrl });
            await win.loadURL(url);
            win.setAlwaysOnTop(true, 'screen-saver'); win.show();
            await win.webContents.executeJavaScript(frameReady);
          }
          samples.push({ totalMs: performance.now() - start, grabMs: grabbed - start, encodeMs: encoded });
          for (const win of windows.splice(0)) win.destroy();
          payloads.clear();
          console.log(JSON.stringify({ mode, sample: i + 1, ...samples.at(-1) }));
          await sleep(200);
        }
      } else {
        const { CaptureController } = require('../dist-electron/main/capture.js');
        controller = new CaptureController({
          grabber: new (require('../dist-electron/main/screenCapture.js').ScreenGrabber)(path.join(root, 'resources', 'capture', 'win32-x64', 'screen-capture.exe')),
          createWindow: options => new BrowserWindow({ ...options, webPreferences: {
            preload, contextIsolation: true, nodeIntegration: false, sandbox: false, ...options.webPreferences
          } }),
          pageUrl: () => url,
          onTiming: timing => samples.push(timing)
        });
        ipcMain.handle('capture:get-payload', event => controller.getPayload(event.sender.id));
        ipcMain.handle('capture:ready', (event, id) => controller.rendererReady(event.sender.id, id));
        ipcMain.handle('capture:cancel', () => controller.cancel());
        await controller.prewarm();
        for (let i = 0; i < sampleCount; i++) {
          await controller.start();
          if (samples.length !== i + 1) throw new Error('Capture was canceled before becoming visible');
          console.log(JSON.stringify({ mode, sample: i + 1, ...samples.at(-1) }));
          controller.cancel();
          await sleep(200);
        }
      }
      const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
      const report = { mode, electron: process.versions.electron, displays: displays.map(d => ({ size: d.size, scaleFactor: d.scaleFactor })),
        medianMs: percentile(samples.map(s => s.totalMs), .5), p95Ms: percentile(samples.map(s => s.totalMs), .95), samples };
      fs.mkdirSync(path.join(root, 'output'), { recursive: true });
      fs.writeFileSync(path.join(root, 'output', `capture-${mode}.json`), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { controller?.dispose(); for (const win of windows) if (!win.isDestroyed()) win.destroy(); app.exit(process.exitCode || 0); }
  });
}
