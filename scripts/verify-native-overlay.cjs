// Real Win32 selection tests against synthetic fixture windows, optionally packaged resources.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const packaged = process.argv[2] === 'packaged';
const assets = packaged ? path.join(root, 'release', 'win-unpacked') : root;
const code = packaged ? path.join(assets, 'resources', 'app.asar') : root;
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename, ...process.argv.slice(2)], { env, cwd: root, windowsHide: true, stdio: 'inherit' });
  child.on('exit', value => process.exit(value ?? 1));
} else {
  const { app, BrowserWindow, screen, nativeImage, globalShortcut } = require('electron');
  const { NativeCaptureController } = require(path.join(code, 'dist-electron', 'main', 'nativeCapture.js'));
  const { ScreenGrabber } = require(path.join(code, 'dist-electron', 'main', 'screenCapture.js'));
  app.setPath('userData', path.join(root, 'output', `native-verify-profile-${Date.now()}`));
  app.getAppPath = () => assets;
  app.on('window-all-closed', () => {});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => { for (let i = 0; i < 400; i++) { if (predicate()) return; await sleep(25); } throw new Error('Native interaction timed out'); };
  const runKeys = command => new Promise((resolve, reject) => {
    const declaration = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NinNativeInput { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra); }'; [NinNativeInput]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null; `;
    execFile('powershell.exe', ['-NoProfile', '-Command', declaration + command], { windowsHide: true }, error => error ? reject(error) : resolve());
  });
  const mouseMove = point => `[NinNativeInput]::SetCursorPos(${Math.round(point.x)},${Math.round(point.y)}) | Out-Null; `;
  const mouse = flags => `[NinNativeInput]::mouse_event(${flags},0,0,0,[UIntPtr]::Zero); `;
  const key = (value, flag) => `[NinNativeInput]::keybd_event(${value},0,${flag},[UIntPtr]::Zero); `;
  app.whenReady().then(async () => {
    const fixtures = [], checks = [], timings = [], failures = [];
    const output = path.join(root, 'output', 'playwright', packaged ? 'native-overlay-packaged' : 'native-overlay');
    let controller, grabber, selection;
    const originalPointer = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    try {
      fs.mkdirSync(output, { recursive: true });
      const displays = screen.getAllDisplays();
      for (const display of displays) {
        const fixture = new BrowserWindow({ ...display.bounds, frame: false, show: false, skipTaskbar: true, webPreferences: { sandbox: true, backgroundThrottling: false } });
        fixtures.push(fixture);
        await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
          html,body{margin:0;width:100%;height:100%;background:#eef3ff;font-family:Segoe UI,Microsoft YaHei UI,sans-serif;overflow:hidden}
          article{position:absolute;left:40px;top:100px;padding:20px;width:400px;background:white;color:#182d51;font-size:24px;line-height:1.5}
          .marker{position:absolute;left:20px;top:20px;width:30px;height:30px;background:rgb(17,34,51)}
          </style></head><body><div class="marker"></div><article>Screenshot translation<br>截图翻译响应测试<br>Native selection window</article></body></html>`));
        fixture.setAlwaysOnTop(true, 'floating'); fixture.showInactive();
      }
      await sleep(300);
      controller = new NativeCaptureController({ executable: path.join(assets, 'resources', 'capture', 'win32-x64', 'screen-overlay.exe'),
        onSelection: value => { selection = value; }, onTiming: timing => timings.push(timing), onFailure: error => failures.push(error.message) });
      grabber = new ScreenGrabber(path.join(assets, 'resources', 'capture', 'win32-x64', 'screen-capture.exe'));
      await controller.prewarm();
      const grab = async () => {
        const result = await grabber.grab(displays);
        return result.frames.map(frame => {
          const width = frame.bitmap.readInt32LE(18), height = -frame.bitmap.readInt32LE(22);
          return nativeImage.createFromBitmap(frame.bitmap.subarray(54), { width, height });
        });
      };
      const first = displays[0], base = first.bounds;
      const waitForFixtureColor = async rgb => {
        for (let attempt=0;attempt<30;attempt++) {
          const frame=(await grab())[0];
          const pixel=frame.crop({x:Math.round(30*first.scaleFactor),y:Math.round(30*first.scaleFactor),width:1,height:1}).toBitmap();
          if([...pixel.subarray(0,3)].every((value,i)=>Math.abs(value-rgb[2-i])<=3)) return;
        }
        throw new Error('Fixture content was not physically presented before capture');
      };
      const start = screen.dipToScreenPoint({ x: base.x + 45, y: base.y + 105 });
      const end = screen.dipToScreenPoint({ x: base.x + 430, y: base.y + 260 });
      await runKeys(mouseMove(start));
      let activated = false;
      assert(globalShortcut.register('Control+Alt+Shift+F10', () => { void controller.start().then(() => { activated = true; }); }));
      await runKeys(key(17,0) + key(18,0) + key(16,0) + key(121,0) + key(121,2) + key(16,2) + key(18,2) + key(17,2));
      await waitFor(() => activated);
      const shown = await grab();
      for (let i = 0; i < shown.length; i++) fs.writeFileSync(path.join(output, `screen-${i}.png`), shown[i].toPNG());
      checks.push('Actual global shortcut opens native overlays on every monitor, with composed-frame acknowledgement');
      // Escape cancellation must restore the underlying application's original marker.
      await runKeys(key(27,0) + key(27,2)); await sleep(100);
      const clean = await grab();
      const expectedX = Math.round(30 * first.scaleFactor), expectedY = Math.round(30 * first.scaleFactor);
      const pixel = clean[0].crop({ x: expectedX, y: expectedY, width: 1, height: 1 }).toBitmap();
      assert([...pixel.subarray(0,3)].every((value,i) => Math.abs(value - [51,34,17][i]) <= 3));
      checks.push('Escape closes the native overlays and restores the underlying screen');
      await fixtures[0].webContents.executeJavaScript("document.querySelector('.marker').style.background='rgb(68,85,102)'; new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      await controller.start();
      await runKeys(mouseMove(start) + mouse(2) + 'Start-Sleep -Milliseconds 70; ' + mouseMove(end));
      await sleep(50);
      fs.writeFileSync(path.join(output, 'selection.png'), (await grab())[0].toPNG());
      await runKeys(mouse(4));
      await waitFor(() => selection);
      const crop = nativeImage.createFromDataURL(selection.imageDataUrl);
      const expectedWidth = Math.round(Math.abs(end.x - start.x) * (Math.abs(end.x - start.x) < 1400 ? 2 : 1));
      assert.equal(crop.getSize().width, expectedWidth);
      const expectedBounds = screen.screenToDipRect(null, { x:start.x, y:start.y, width:end.x-start.x, height:end.y-start.y });
      assert.deepEqual(selection.screenBounds, expectedBounds);
      checks.push('Real Win32 pointer drag returns only the selected PNG with correct DPI coordinates and enhancement dimensions');
      const { recognizeImage, terminateOcr } = require(path.join(code, 'dist-electron', 'main', 'ocr.js'));
      try {
        const result = await recognizeImage(selection.imageDataUrl, 'zh-en-fast');
        assert(result.text.toLowerCase().includes('screenshot translation'), result.text);
        assert(result.text.includes('截图翻译'), result.text);
      } finally { await terminateOcr(); }
      checks.push('Selected native crop passes actual Chinese and English RapidOCR');
      selection = undefined;
      await controller.start();
      await runKeys(mouse(8) + mouse(16)); await sleep(100);
      const before = timings.length;
      await controller.start(); assert.equal(timings.length, before + 1);
      controller.cancel();
      checks.push('Right-click cancellation and repeated activation remain usable');
      // Check selection on the second monitor with its own scaling factor.
      if (displays.length > 1) {
        const secondary = displays[1];
        const a = screen.dipToScreenPoint({ x: secondary.bounds.x + 45, y: secondary.bounds.y + 105 });
        const b = screen.dipToScreenPoint({ x: secondary.bounds.x + 430, y: secondary.bounds.y + 260 });
        await runKeys(mouseMove(a)); await controller.start();
        await runKeys(mouse(2) + mouseMove(b) + 'Start-Sleep -Milliseconds 70; ' + mouse(4));
        await waitFor(() => selection);
        assert.deepEqual(selection.screenBounds, screen.screenToDipRect(null,{x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y}));
        checks.push('Secondary monitor selection preserves its distinct scaling and global coordinates');
      }
      for (const text of ['画面翻訳', 'Перевод экрана']) {
        selection = undefined;
        await runKeys(mouseMove(start));
        const marker = text === '画面翻訳' ? [68,85,102] : [119,136,153];
        await fixtures[0].webContents.executeJavaScript(`document.querySelector('article').textContent=${JSON.stringify(text)}; document.querySelector('.marker').style.background=${JSON.stringify(`rgb(${marker.join(',')})`)}; new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await waitForFixtureColor(marker);
        await controller.start();
        await runKeys(mouseMove(start) + mouse(2) + 'Start-Sleep -Milliseconds 70; ' + mouseMove(end) + mouse(4));
        await waitFor(() => selection);
        try {
          const { recognizeImage, terminateOcr } = require(path.join(code, 'dist-electron', 'main', 'ocr.js'));
          try {
            const result = await recognizeImage(selection.imageDataUrl, 'multilingual');
            assert(result.text.replace(/\s+/gu, '').includes(text.replace(/\s+/gu, '')), result.text);
          } finally { await terminateOcr(); }
        } finally { controller.cancel(); }
      }
      checks.push('Native crop preserves Japanese and Cyrillic text for actual multilingual OCR');
      // Render a real narrow native window without changing the user's display settings.
      const originalDisplays = screen.getAllDisplays;
      const narrow = { ...first, bounds: { x: base.x + 100, y: base.y + 100, width: 360, height: 280 } };
      try {
        screen.getAllDisplays = () => [narrow];
        await controller.start();
        const physical = screen.dipToScreenRect(null, narrow.bounds);
        const fullPhysical = screen.dipToScreenRect(null, first.bounds);
        const image = (await grab())[0].crop({ x: physical.x - fullPhysical.x, y: physical.y - fullPhysical.y, width: physical.width, height: physical.height });
        fs.writeFileSync(path.join(output, 'narrow.png'), image.toPNG());
        const { recognizeImage, terminateOcr } = require(path.join(code, 'dist-electron', 'main', 'ocr.js'));
        try {
          const help = await recognizeImage(image.toDataURL(), 'zh-en-fast');
          assert(help.text.includes('拖动') && help.text.includes('取消'), help.text);
        } finally { await terminateOcr(); }
      } finally { controller.cancel(); screen.getAllDisplays = originalDisplays; }
      checks.push('360-DIP native help wraps into readable lines; actual screenshot OCR finds both drag and cancel instructions');
      assert.deepEqual(failures, []);
      const previousPid = controller.child.pid;
      controller.child.kill();
      await waitFor(() => failures.length > 0);
      await sleep(1600); await controller.prewarm();
      assert.notEqual(controller.child.pid, previousPid);
      await controller.start(); controller.cancel();
      assert.equal(failures.length, 1);
      const recoveredEvents = failures.splice(0);
      checks.push('After deliberately terminating the helper, automatic recovery starts a new process and screenshot selection works again');
      assert.deepEqual(failures, []);
      fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, timings, failures, recoveredEvents }, null, 2));
      console.log(JSON.stringify({ checks, timings, failures, recoveredEvents }, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally {
      globalShortcut.unregisterAll(); controller?.dispose(); grabber?.dispose();
      for (const fixture of fixtures) if (!fixture.isDestroyed()) fixture.destroy();
      await runKeys(mouse(4) + mouseMove(originalPointer)).catch(() => {});
      app.exit(process.exitCode || 0);
    }
  });
}
