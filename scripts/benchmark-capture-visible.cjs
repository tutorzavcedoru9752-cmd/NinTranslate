// Same screen-pixel visibility probe for both old Electron and new native overlays.
// Only numerical measurements are saved. Fixtures contain generated local text.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  const { app, BrowserWindow, screen, ipcMain } = require('electron');
  const { CaptureController, registerCaptureScheme } = require('../dist-electron/main/capture.js');
  const { NativeCaptureController } = require('../dist-electron/main/nativeCapture.js');
  const { ScreenGrabber } = require('../dist-electron/main/screenCapture.js');
  registerCaptureScheme();
  const helpers = process.env.NINTRANSLATE_CAPTURE_HELPER_ROOT || path.join(root, 'resources', 'capture', 'win32-x64');
  app.setPath('userData', path.join(root, 'output', `capture-visible-profile-${Date.now()}`));
  app.on('window-all-closed', () => {});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  app.whenReady().then(async () => {
    const fixtures = [], samples = [];
    let controller, probe, currentTiming;
    let lastProbe;
    try {
      const displays = screen.getAllDisplays();
      for (const display of displays) {
        const window = new BrowserWindow({ ...display.bounds, frame:false, show:false, skipTaskbar:true, webPreferences:{sandbox:true,backgroundThrottling:false} });
        fixtures.push(window);
        await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#eef3ff;font:22px Segoe UI,Microsoft YaHei UI;color:#273c60"><div style="position:absolute;left:50px;top:100px;width:30px;height:30px;background:rgb(17,34,51)"></div><main style="margin:180px 50px;display:grid;grid-template-columns:repeat(3,1fr);gap:30px">${Array.from({length:30},(_,i)=>`<p>Local fixture ${i+1}<br>Screenshot translation should respond after idle.<br>截图测试只使用本地生成的文字。</p>`).join('')}</main></body></html>`));
        window.setAlwaysOnTop(true,'floating'); window.showInactive();
      }
      await sleep(200);
      probe = new ScreenGrabber(path.join(helpers,'screen-capture.exe')); await probe.prewarm();
      const raw = await probe.grab(displays);
      const points = displays.map((display,index) => {
        const bitmap = raw.frames[index].bitmap;
        const width = bitmap.readInt32LE(18), x = Math.round(60*display.scaleFactor), y = Math.round(110*display.scaleFactor);
        const offset = 54+(y*width+x)*4;
        const before = [...bitmap.subarray(offset,offset+3)];
        return {x,y,expected:before.map((value,k)=>value*.58+[14,10,8][k]*.42)};
      });
      ipcMain.handle('capture:get-payload', event => controller?.getPayload?.(event.sender.id) ?? null);
      ipcMain.handle('capture:ready', (event,id)=>controller?.rendererReady?.(event.sender.id,id));
      ipcMain.handle('capture:cancel', ()=>controller?.cancel());
      for (const backend of ['electron-overlay','native-overlay']) {
        if (backend==='electron-overlay') controller = new CaptureController({
          grabber:new ScreenGrabber(path.join(helpers,'screen-capture.exe')),
          createWindow:options=>new BrowserWindow({...options,webPreferences:{preload:path.join(root,'dist-electron','preload','index.js'),contextIsolation:true,sandbox:false,nodeIntegration:false,...options.webPreferences}}),
          pageUrl:()=>pathToFileURL(path.join(root,'dist','index.html')).href+'#/overlay', onTiming:timing=>{currentTiming=timing;}
        });
        else controller = new NativeCaptureController({executable:path.join(helpers,'screen-overlay.exe'),onSelection:()=>{},onTiming:timing=>{currentTiming=timing;}});
        await controller.prewarm();
        const gaps = backend==='electron-overlay' ? [0,30000] : [0,15000,30000,60000,120000];
        for (const gapMs of gaps) {
          console.log(JSON.stringify({backend,waitingMs:gapMs})); await sleep(gapMs);
          const start = performance.now(); await controller.start();
          let visible=false, readbacks=0;
          for(;readbacks<10;readbacks++) {
            const frames=(await probe.grab(displays)).frames;
            lastProbe = [];
            visible=frames.every((frame,index)=>{
              const {x,y,expected}=points[index], width=frame.bitmap.readInt32LE(18), offset=54+(y*width+x)*4;
              const actual=[...frame.bitmap.subarray(offset,offset+3)];
              lastProbe.push({actual,expected});
              return actual.every((value,k)=>Math.abs(value-expected[k])<=6);
            });
            if(visible) break;
          }
          if(!visible) throw new Error(`${backend}: actual overlay pixels never appeared`);
          const sample={backend,gapMs,...currentTiming,composedVisibleMs:performance.now()-start,readbacks:readbacks+1};
          // Keep the backend name distinct from the underlying screen-grab implementation.
          sample.backend=backend; samples.push(sample); console.log(JSON.stringify(sample));
          fs.writeFileSync(path.join(root,'output','capture-visible-comparison.json'),JSON.stringify({samples},null,2));
          await sleep(300); controller.cancel(); await sleep(250);
        }
        controller.dispose(); controller=undefined;
      }
      const report={method:'Identical GDI screen-pixel probe for every monitor; first matching dimmed fixture marker, including readback overhead',samples};
      fs.writeFileSync(path.join(root,'output','capture-visible-comparison.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify(report,null,2));
    } catch(error) {console.error(error); console.error(JSON.stringify({active:Boolean(controller?.active),lastProbe}));fs.writeFileSync(path.join(root,'output','capture-visible-comparison.json'),JSON.stringify({samples,error:String(error),lastProbe},null,2));process.exitCode=1;}
    finally {controller?.dispose();probe?.dispose();for(const window of fixtures)if(!window.isDestroyed())window.destroy();app.exit(process.exitCode||0);}
  });
}
