// Measure native window painting after real idle gaps; no screenshots are saved.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const label = process.argv[2] || 'native';
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, label], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 1));
} else {
  const { app, screen } = require('electron');
  const { NativeCaptureController } = require('../dist-electron/main/nativeCapture.js');
  app.setPath('userData', path.join(root, 'output', `native-benchmark-profile-${Date.now()}`));
  app.on('window-all-closed', () => {});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const gaps = JSON.parse(process.env.NINTRANSLATE_CAPTURE_GAPS_MS || '[0,15000,30000,60000,120000]');
  app.whenReady().then(async () => {
    const samples = [], failures = [];
    const controller = new NativeCaptureController({ executable: path.join(root, 'resources', 'capture', 'win32-x64', 'screen-overlay.exe'),
      onSelection: () => {}, onTiming: timing => samples.push(timing), onFailure: error => failures.push(error.message) });
    try {
      await controller.prewarm();
      for (const gapMs of gaps) {
        console.log(JSON.stringify({ label, waitingMs: gapMs }));
        await sleep(gapMs);
        const count = samples.length;
        await controller.start();
        if (samples.length !== count + 1) throw new Error('Missing actual native shown acknowledgement');
        samples.at(-1).gapMs = gapMs;
        console.log(JSON.stringify({ label, ...samples.at(-1) }));
        await sleep(500); controller.cancel();
      }
      const sorted = samples.map(s => s.totalMs).sort((a, b) => a - b);
      const report = { label, version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
        method: 'Shortcut callback through native window Show/Update and DwmFlush acknowledgement',
        displays: screen.getAllDisplays().map(d => ({ size: d.size, scaleFactor: d.scaleFactor })),
        medianMs: sorted[Math.ceil(sorted.length / 2) - 1], maxMs: Math.max(...sorted), samples, failures };
      fs.writeFileSync(path.join(root, 'output', `capture-idle-${label}.json`), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { controller.dispose(); app.exit(process.exitCode || 0); }
  });
}
