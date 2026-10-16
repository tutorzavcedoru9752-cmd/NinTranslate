// Real Electron/Win32 integration checks using synthetic, full-screen fixtures.
// Only fixture screenshots are saved; normal desktop captures stay in memory.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const packaged = process.argv[2] === 'packaged';
const assetRoot = packaged ? path.join(root, 'release', 'win-unpacked') : root;
const codeRoot = packaged ? path.join(assetRoot, 'resources', 'app.asar') : root;
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  const { app, BrowserWindow, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
  const { CaptureController, registerCaptureScheme } = require(path.join(codeRoot, 'dist-electron', 'main', 'capture.js'));
  const { ScreenGrabber } = require(path.join(codeRoot, 'dist-electron', 'main', 'screenCapture.js'));
  registerCaptureScheme();
  app.setPath('userData', path.join(root, 'output', `capture-verify-profile-${Date.now()}`));
  app.getAppPath = () => assetRoot;
  app.on('window-all-closed', () => {});
  const artifactRoot = path.join(root, 'output', 'playwright', packaged ? 'capture-packaged' : 'capture');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await sleep(20); } throw new Error('Condition timed out'); };
  app.whenReady().then(async () => {
    let controller, grabber;
    const overlays = [], fixtures = [], errors = [], checks = [];
    let selection;
    try {
      fs.mkdirSync(artifactRoot, { recursive: true });
      const displays = screen.getAllDisplays();
      for (const display of displays) {
        const fixture = new BrowserWindow({ ...display.bounds, frame: false, skipTaskbar: true, show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
        fixtures.push(fixture);
        await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
          html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eef3ff;font-family:Segoe UI,Microsoft YaHei UI,sans-serif}
          article{position:absolute;left:40px;top:100px;width:400px;padding:20px;background:white;color:#182d51;font-size:24px;line-height:1.5}
          .marker{position:absolute;left:20px;top:20px;width:30px;height:30px;background:rgb(17,34,51)}
          </style></head><body><div class="marker"></div><article>Screenshot translation<br>截图翻译响应测试<br>Local screen ${display.id}</article></body></html>`));
        fixture.setAlwaysOnTop(true, 'floating'); fixture.showInactive();
      }
      await sleep(400);
      grabber = new ScreenGrabber(path.join(assetRoot, 'resources', 'capture', 'win32-x64', 'screen-capture.exe'));
      controller = new CaptureController({ grabber, pageUrl: () => pathToFileURL(path.join(codeRoot, 'dist', 'index.html')).href + '#/overlay',
        createWindow: options => {
          const win = new BrowserWindow({ ...options, webPreferences: { preload: path.join(codeRoot, 'dist-electron', 'preload', 'index.js'),
            contextIsolation: true, nodeIntegration: false, sandbox: false, ...options.webPreferences } });
          overlays.push(win);
          win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
          return win;
        }
      });
      ipcMain.handle('capture:get-payload', event => controller.getPayload(event.sender.id));
      ipcMain.handle('capture:ready', (event, id) => controller.rendererReady(event.sender.id, id));
      ipcMain.handle('capture:cancel', () => controller.cancel());
      ipcMain.handle('capture:complete', (event, result) => {
        assert(controller.accepts(event.sender.id, result.sessionId)); selection = result; controller.cancel();
      });
      await controller.prewarm();
      const source = await grabber.grab(displays);
      assert.equal(source.backend, 'native');
      for (const [index, frame] of source.frames.entries()) {
        assert.equal(frame.bitmap.subarray(0, 2).toString(), 'BM');
        const size = { width: frame.bitmap.readInt32LE(18), height: -frame.bitmap.readInt32LE(22) };
        const expected = screen.dipToScreenRect(null, displays[index].bounds);
        assert.deepEqual(size, { width: expected.width, height: expected.height });
        const offset = 54 + (Math.round(30 * displays[index].scaleFactor) * size.width + Math.round(30 * displays[index].scaleFactor)) * 4;
        const marker = frame.bitmap.subarray(offset, offset + 4);
        assert([...marker.subarray(0, 3)].every((value, i) => Math.abs(value - [51, 34, 17][i]) <= 2), 'Physical display color profile shifted the marker unexpectedly');
      }
      checks.push('Native frame dimensions and BGRA marker positions match each physical DPI-scaled display (color profile tolerance 2/255)');
      const accelerator = 'Control+Alt+Shift+F10';
      let hotkeyDone;
      const hotkeyPromise = new Promise(resolve => { hotkeyDone = resolve; });
      assert(globalShortcut.register(accelerator, () => { void controller.start().then(hotkeyDone); }));
      const { execFile } = require('node:child_process');
      const sendHotkey = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NinTestKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [NinTestKeys]::keybd_event(17,0,0,[UIntPtr]::Zero); [NinTestKeys]::keybd_event(18,0,0,[UIntPtr]::Zero); [NinTestKeys]::keybd_event(16,0,0,[UIntPtr]::Zero); [NinTestKeys]::keybd_event(121,0,0,[UIntPtr]::Zero); [NinTestKeys]::keybd_event(121,0,2,[UIntPtr]::Zero); [NinTestKeys]::keybd_event(16,0,2,[UIntPtr]::Zero); [NinTestKeys]::keybd_event(18,0,2,[UIntPtr]::Zero); [NinTestKeys]::keybd_event(17,0,2,[UIntPtr]::Zero)`;
      await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', sendHotkey], { windowsHide: true }, error => error ? reject(error) : resolve()));
      await Promise.race([hotkeyPromise, sleep(5000).then(() => { throw new Error('OS shortcut did not activate'); })]);
      assert(overlays.every(win => win.isVisible()));
      checks.push('Actual Windows global hotkey activates all warmed capture overlays above fixture applications');
      globalShortcut.unregister(accelerator);
      const overlay = overlays[0];
      await sleep(120);
      const screenshot = await overlay.webContents.capturePage();
      fs.writeFileSync(path.join(artifactRoot, 'desktop.png'), screenshot.toPNG());
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await waitFor(() => overlays.every(win => !win.isVisible()));
      assert.equal(controller.getPayload(overlay.webContents.id), null);
      checks.push('Escape hides every overlay and clears capture payloads');
      await fixtures[0].webContents.executeJavaScript("document.querySelector('.marker').style.background='rgb(68,85,102)'");
      await fixtures[0].webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await controller.start();
      const payload = controller.getPayload(overlay.webContents.id);
      const colors = await overlay.webContents.executeJavaScript(`new Promise(resolve => { const image=new Image(); image.crossOrigin='anonymous'; image.onload=()=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);resolve([...x.getImageData(${Math.round(30 * displays[0].scaleFactor)},${Math.round(30 * displays[0].scaleFactor)},1,1).data].slice(0,3));}; image.src=${JSON.stringify(payload.imageDataUrl)}; })`);
      assert(colors.every((value, i) => Math.abs(value - [68, 85, 102][i]) <= 2), `Unexpected fresh marker RGB: ${JSON.stringify(colors)}`);
      checks.push('Repeated capture contains fresh screen pixels, not a cached or self-captured overlay');
      const input = event => overlay.webContents.sendInputEvent(event);
      input({ type: 'mouseDown', x: 45, y: 105, button: 'left', clickCount: 1 });
      await sleep(40);
      input({ type: 'mouseMove', x: 430, y: 260, button: 'left' });
      await sleep(40);
      input({ type: 'mouseUp', x: 430, y: 260, button: 'left', clickCount: 1 });
      await waitFor(() => selection);
      assert(Math.abs(selection.screenBounds.width - 385) < .01); assert(Math.abs(selection.screenBounds.height - 155) < .01);
      assert(Math.abs(selection.screenBounds.x - displays[0].bounds.x - 45) < .01);
      const cropped = nativeImage.createFromDataURL(selection.imageDataUrl);
      assert(!cropped.isEmpty());
      checks.push('Real pointer drag crops a nonempty PNG with correct logical coordinates and permits CORS canvas access');
      const { recognizeImage, terminateOcr } = require(path.join(codeRoot, 'dist-electron', 'main', 'ocr.js'));
      try {
        const result = await recognizeImage(selection.imageDataUrl, 'zh-en-fast');
        assert(result.text.toLowerCase().includes('screenshot translation'), result.text);
        assert(result.text.includes('截图翻译'), result.text);
        checks.push('Cropped, enhanced capture passes real local RapidOCR for both Chinese and English');
      } finally { await terminateOcr(); }
      controller.cancel();
      const fallback = new ScreenGrabber(path.join(root, 'output', 'missing-capture-helper.exe'));
      try { assert.equal((await fallback.grab(displays)).backend, 'electron'); }
      finally { fallback.dispose(); }
      checks.push('Missing native helper automatically falls back to Electron capture');
      // Render the production overlay at a narrow size with the synthetic source.
      await controller.start();
      overlay.setBounds({ x: displays[0].bounds.x + 20, y: displays[0].bounds.y + 20, width: 360, height: 280 });
      await sleep(100);
      const helpFits = await overlay.webContents.executeJavaScript(`(() => {const r=document.querySelector('.capture-help').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && document.documentElement.scrollWidth===innerWidth;})()`);
      assert(helpFits);
      fs.writeFileSync(path.join(artifactRoot, 'narrow.png'), (await overlay.webContents.capturePage()).toPNG());
      checks.push('Production overlay help fits desktop and 360px narrow windows without horizontal overflow');
      assert.deepEqual(errors, []);
      checks.push('No renderer console errors');
      fs.writeFileSync(path.join(artifactRoot, 'checks.json'), JSON.stringify({ checks, errors, displays: displays.map(d => ({ bounds: d.bounds, scaleFactor: d.scaleFactor })) }, null, 2));
      console.log(JSON.stringify({ checks, errors }, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { globalShortcut.unregisterAll(); controller?.dispose(); grabber?.dispose(); for (const win of [...overlays, ...fixtures]) if (!win.isDestroyed()) win.destroy(); app.exit(process.exitCode || 0); }
  });
}
