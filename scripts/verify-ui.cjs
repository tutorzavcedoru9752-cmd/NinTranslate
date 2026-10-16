// Production renderer + actual Electron preload, using isolated, synthetic data.
// No user credentials, history, screenshots or external translation calls are read.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('packaged');
const codeRoot = packaged ? path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar') : root;
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  const { app, BrowserWindow, ipcMain, nativeTheme, clipboard } = require('electron');
  const out = path.join(root, 'output', 'playwright', packaged ? 'ui-v1.7.0-packaged' : 'ui-v1.7.0');
  app.setPath('userData', path.join(root, 'output', `ui-verify-profile-${Date.now()}`));
  app.on('window-all-closed', () => {});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const checks = [], errors = [];
  let settings = { provider: 'baidu', endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate', region: '', hotkey: 'Alt+Shift+T', launchAtLogin: false, theme: 'system', defaultTargetLanguage: 'zh-Hans', recognitionMode: 'zh-en-fast', hasCredentials: true, hasBaiduCredentials: true, hasMicrosoftApiKey: false };
  const original = 'Clear tools preserve meaning when a sentence wraps across several visual lines.\n\nDesign decisions become easier to review when the original text remains editable.';
  const translation = '清晰的工具能在句子跨越多个视觉行时保留原意。\n\n当原文可以编辑时，设计决策也更容易审阅。';
  const seedHistory = () => [
    { id: 'one', createdAt: '2026-10-15T08:30:00Z', sourceLanguage: 'en', targetLanguage: 'zh-Hans', sourceText: original, translatedText: translation },
    { id: 'two', createdAt: '2026-10-15T07:20:00Z', sourceLanguage: 'ja', targetLanguage: 'zh-Hans', sourceText: '画面の改行と文章の段落は同じではありません。\n認識した文章を編集して、もう一度翻訳できます。', translatedText: '屏幕上的换行并不等于文章的分段。\n可以编辑识别后的文字，再次翻译。' }
  ];
  let history = seedHistory(), state, win, captured = 0, saved, connectionOk = true;
  const readyState = () => ({ id: 'fixture', status: 'ready', sourceLanguage: 'en', targetLanguage: 'zh-Hans', sourceText: original, translatedText: translation, confidence: 98, pinned: false, sourceEdited: false, flowMode: 'smart', recognitionMode: 'zh-en-fast' });
  const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { console.error('Evaluation failed:', code, errors); throw error; } };
  const click = async selector => {
    const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing selector'); e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await sleep(120);
  };
  const key = async (keyCode, modifiers = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await sleep(80); };
  const fill = async (selector, value) => { await click(selector); await key('A', ['control']); win.webContents.insertText(value); await sleep(100); };
  const select = async (selector, value) => { await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(120); };
  const update = async next => { state = { ...state, ...next }; win.webContents.send('result:update', state); await sleep(120); };
  const shot = async name => {
    // A DOM assertion can precede compositor paint; never accept an empty/stale first frame.
    win.webContents.invalidate();
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    await sleep(150);
    for (let attempt = 0; attempt < 8; attempt++) {
      const capture = await win.webContents.capturePage();
      const png = capture.toPNG();
      if (!capture.isEmpty() && png.length > 1000) { fs.writeFileSync(path.join(out, `${name}.png`), png); return; }
      await sleep(150);
    }
    throw new Error(`No composed screenshot for ${name}`);
  };
  const layoutCheck = async label => {
    const issues = await js(`(()=>{
      const issues=[];
      for(const e of document.querySelectorAll('button,input,select,textarea,.panel-label,.history-meta,.settings-card,.sticky-save')){
        const r=e.getBoundingClientRect();const s=getComputedStyle(e);
        if(!r.width||!r.height||s.display==='none'||s.visibility==='hidden')continue;
        if(r.left<-.6||r.right>innerWidth+.6)issues.push(e.className+' horizontal overflow '+r.left+':'+r.right);
        if(e.matches('input,select')&&r.height<25.5)issues.push('tiny control');
      }
      if(document.documentElement.scrollWidth>innerWidth)issues.push('document overflow');
      return issues;
    })()`);
    assert.deepEqual(issues, [], `${label}: ${issues.join('; ')}`); checks.push(label);
  };
  const contrastCheck = async label => {
    const issues = await js(`(()=>{
      const rgb=s=>s.match(/[\\d.]+/g)?.map(Number)||[0,0,0,0];
      const lum=c=>{const v=c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};
      const issues=[];
      for(const e of document.querySelectorAll('button,input,select,p,span,small,strong,kbd,h1,h2,label,summary')){
        if(e.matches(':disabled')||e.closest(':disabled'))continue;
        const r=e.getBoundingClientRect(),s=getComputedStyle(e);
        if(!r.width||!r.height||r.bottom<0||r.top>innerHeight||s.visibility==='hidden')continue;
        const text=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
        if(!text&&!e.matches('select,input'))continue;
        let bg=[255,255,255,1]; const chain=[];for(let p=e;p;p=p.parentElement)chain.unshift(p);
        for(const p of chain){const c=rgb(getComputedStyle(p).backgroundColor),a=c[3]??1;bg=c.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a));}
        const fg=rgb(s.color),ratio=(Math.max(lum(bg),lum(fg))+.05)/(Math.min(lum(bg),lum(fg))+.05);
        const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
        if(ratio<(large?3:4.5)-.02)issues.push({text:text.slice(0,30)||e.tagName,ratio:+ratio.toFixed(2),color:s.color});
      }return issues;
    })()`);
    assert.deepEqual(issues, [], `Text contrast ${label}: ${JSON.stringify(issues)}`); checks.push(`Text contrast >=4.5:1 (large >=3:1), ${label}`);
  };
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    ipcMain.handle('settings:get', () => settings);
    ipcMain.handle('settings:save', (_event, next) => { saved = next; settings = { ...settings, ...next }; return settings; });
    ipcMain.handle('settings:test', async () => { await sleep(200); return { ok: connectionOk, message: connectionOk ? '连接成功，可以开始截图翻译。' : '服务凭据验证失败，请检查 APP ID 和密钥后重试。' }; });
    ipcMain.handle('history:list', () => history);
    ipcMain.handle('history:delete', (_event, id) => (history = history.filter(e => e.id !== id)));
    ipcMain.handle('history:clear', () => (history = []));
    ipcMain.handle('app:start-capture', () => { captured++; });
    for (const name of ['app:open-settings', 'app:open-external', 'window:minimize', 'window:close', 'result:close']) ipcMain.handle(name, () => {});
    ipcMain.handle('result:get', () => state);
    ipcMain.handle('result:copy', (_event, text) => { clipboard.writeText(text); });
    ipcMain.handle('result:pin', (_event, _id, pinned) => update({ pinned }));
    ipcMain.handle('result:resize', (_event, _id, width, height) => win.setContentSize(width, height));
    ipcMain.handle('result:set-target', (_event, _id, targetLanguage) => update({ targetLanguage }));
    ipcMain.handle('result:set-flow-mode', (_event, _id, flowMode) => update({ flowMode }));
    ipcMain.handle('result:update-source', async (_event, _id, sourceText) => { await update({ sourceText, sourceEdited: true }); });
    ipcMain.handle('result:swap', () => update({ sourceText: state.translatedText, translatedText: state.sourceText, sourceLanguage: state.targetLanguage, targetLanguage: state.sourceLanguage }));
    ipcMain.handle('result:retry', () => update({ status: 'ready', message: undefined, translatedText: translation }));
    const open = async (route, width, height, theme) => {
      if (win) win.destroy(); nativeTheme.themeSource = theme;
      win = new BrowserWindow({ width, height, useContentSize: true, frame: false, show: true, webPreferences: { preload: path.join(codeRoot, 'dist-electron', 'preload', 'index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false } });
      win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
      win.webContents.on('render-process-gone', (_event, details) => errors.push(JSON.stringify(details)));
      await win.loadFile(path.join(codeRoot, 'dist', 'index.html'), { hash: route }); await sleep(250);
    };
    try {
      for (const theme of ['light', 'dark']) {
        history = seedHistory();
        await open('/settings', 960, 760, theme); await layoutCheck(`settings ${theme} 960x760`); await contrastCheck(`settings ${theme}`); await shot(`settings-${theme}`);
        await click('.advanced-settings summary'); await shot(`advanced-${theme}`);
        await click('.card-actions .secondary-button'); await sleep(350); assert(await js(`document.querySelector('.notice')?.textContent.includes('连接成功')`)); checks.push(`connection feedback ${theme}`);
        connectionOk = false; await click('.card-actions .secondary-button'); await sleep(350); assert(await js(`document.querySelector('.notice.error')?.getAttribute('role')==='alert'`)); await contrastCheck(`settings error ${theme}`); await shot(`settings-error-${theme}`); connectionOk = true;
        await select('select[aria-labelledby="target-label"]', 'ja');
        await js(`document.querySelector('.switch').scrollIntoView({block:'center'})`); await click('.switch');
        await click('.sticky-save .primary-button'); assert.equal(saved.defaultTargetLanguage, 'ja'); assert.equal(saved.launchAtLogin, settings.launchAtLogin); checks.push(`settings save ${theme}`);
        await js(`document.querySelector('.page-scroll').scrollTop=9999`); await shot(`preferences-${theme}`);
        win.setContentSize(700, 560); await sleep(100); await layoutCheck(`settings ${theme} minimum 700x560`); await shot(`settings-min-${theme}`);
        win.webContents.setZoomFactor(1.25); await sleep(120); await layoutCheck(`settings ${theme} 125% text scaling`); await shot(`settings-scaled-${theme}`); win.webContents.setZoomFactor(1);
        win.setContentSize(960, 760); await click('.nav-button:nth-of-type(2)'); await layoutCheck(`history ${theme}`); await contrastCheck(`history ${theme}`); await shot(`history-${theme}`);
        await fill('.search-field input', '不存在的关键词'); assert.equal(await js(`document.querySelectorAll('.history-item').length`), 0); await shot(`history-search-empty-${theme}`);
        await click('button[aria-label="清除搜索"]'); assert.equal(await js(`document.querySelectorAll('.history-item').length`), 2); checks.push(`history search/reset ${theme}`);
        await click('.delete-history'); assert.equal(history.length, 1); checks.push(`history delete ${theme}`);
        await js(`void(window.confirm=()=>false)`); await click('.danger-button'); assert.equal(history.length, 1); checks.push(`cancel history clear ${theme}`);
        await js(`void(window.confirm=()=>true)`); await click('.danger-button'); assert.equal(history.length, 0); await shot(`history-empty-${theme}`); checks.push(`history clear ${theme}`);
        await click('.empty-history .primary-button'); assert(captured > 0);
        state = readyState(); await open('/result?id=fixture', 520, 580, theme); await layoutCheck(`result ${theme} 520x580`); await contrastCheck(`result ${theme}`); await shot(`result-${theme}`);
        await click('[aria-label="复制译文"]'); assert.equal(clipboard.readText(), translation); checks.push(`result clipboard ${theme}`);
        await click('[aria-label="固定在最上方"]'); assert.equal(state.pinned, true);
        await click('[aria-label="调整窗口大小"]'); assert.equal(await js('document.activeElement.textContent.includes("紧凑")'), true); await shot(`result-size-${theme}`); await key('Escape'); assert.equal(await js('!!document.querySelector(".size-menu")'), false); checks.push(`size popup keyboard dismissal ${theme}`);
        await select('[aria-label="原文分段方式"]', 'preserve'); assert.equal(state.flowMode, 'preserve'); checks.push(`flow mode select ${theme}`);
        await click('[aria-label="编辑原文"]'); await fill('.source-editor', ' '); assert(await js(`document.querySelector('.save-source').disabled`)); checks.push(`empty edit blocked ${theme}`);
        await fill('.source-editor', 'Edited original.\n\n保留用户手动分段。'); await shot(`result-edit-${theme}`); await key('Enter', ['control']); await sleep(200); assert.equal(state.sourceText, 'Edited original.\n\n保留用户手动分段。'); checks.push(`source edit shortcut ${theme}`);
        assert(await js(`document.querySelector('[aria-label="原文分段方式"]').disabled`));
        await select('[aria-label="目标语言"]', 'ja'); assert.equal(state.targetLanguage, 'ja'); checks.push(`target select ${theme}`);
        await click('[aria-label="编辑原文"]'); await key('Escape'); assert.equal(await js('!!document.querySelector(".source-editor")'), false);
        await update(readyState()); win.setContentSize(360, 320); await sleep(100); await layoutCheck(`result ${theme} minimum 360x320`);
        assert(await js(`(()=>{const p=document.querySelector('.translation-panel').getBoundingClientRect();const f=document.querySelector('.result-footer').getBoundingClientRect();return p.bottom<=f.top+1 && p.height>=80})()`));
        checks.push(`both source/translation visible at minimum height ${theme}`); await shot(`result-min-${theme}`);
        win.setContentSize(400, 440); await sleep(100); await shot(`result-compact-${theme}`);
        await update({ status: 'error', message: '网络连接失败，请检查网络后重试。', translatedText: '' }); await layoutCheck(`result error ${theme}`); await shot(`result-error-${theme}`);
        await click('.result-footer .primary-button'); assert.equal(state.status, 'ready'); checks.push(`retry ${theme}`);
        await update({ status: 'recognizing', sourceText: '', translatedText: '', sourceLanguage: 'auto', message: '正在识别屏幕文字…' }); await shot(`result-loading-${theme}`);
        await update({ status: 'empty', message: '请框选清晰可见的文字后重试。' }); await shot(`result-empty-${theme}`);
        await update({ status: 'needs-config', message: '请在设置中填写翻译服务凭据。' }); await shot(`result-config-${theme}`);
        await update({ ...readyState(), sourceLanguage: 'auto' }); assert(await js(`document.querySelector('.swap-button').disabled`)); checks.push(`unknown language swap disabled ${theme}`);
        await update(readyState()); await click('.swap-button'); assert.equal(state.sourceText, translation); assert.equal(state.sourceLanguage, 'zh-Hans'); checks.push(`swap texts/languages ${theme}`);
        await update({ ...readyState(), sourceLanguage: 'ru' }); await shot(`result-language-${theme}`);
        await js(`void document.querySelector('[aria-label="目标语言"]').focus()`); await key('Tab');
        const focus = await js(`(()=>{const e=document.activeElement,s=getComputedStyle(e);return {element:e.outerHTML.slice(0,250),visible:e.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth}})()`);
        // Chromium snaps a 2-CSS-pixel outline to physical pixels at fractional DPI.
        assert(focus.visible && focus.outline === 'solid' && parseFloat(focus.width) >= 1.5, JSON.stringify(focus)); checks.push(`keyboard focus ring ${theme}`); await shot(`result-focus-${theme}`);
      }
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await sleep(150); await layoutCheck('Emulated Windows forced-colors result'); await shot('result-high-contrast');
      await update({ status: 'recognizing', sourceText: '', translatedText: '', message: '正在识别屏幕文字…' });
      assert.equal(await js(`getComputedStyle(document.querySelector('.spinner')).animationName`), 'none'); checks.push('Reduced motion disables loading animation'); await shot('result-reduced-motion');
      win.webContents.debugger.detach();
      assert.deepEqual(errors, []); checks.push('No renderer console errors or crashes');
      fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, errors, note: 'Actual Electron renderer and production preload, isolated synthetic IPC; no real API/network or user data.' }, null, 2));
      console.log(JSON.stringify({ passed: checks.length, out, errors }, null, 2));
      app.exit(0);
    } catch (error) { console.error(error); if (win && !win.isDestroyed()) await shot('failure'); app.exit(1); }
  });
}
