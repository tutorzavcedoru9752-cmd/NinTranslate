import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

type CaptureMetric = { backend: string; totalMs?: number; nativeGrabMs?: number; nativeTotalMs?: number; grabMs?: number; prepareMs?: number; event?: 'failure' };
const recent: (CaptureMetric & { at: string })[] = [];
let writing = Promise.resolve();

// Small, bounded numerical diagnostics; no pixels, text, credentials or paths.
export function recordCaptureMetric(metric: CaptureMetric): void {
  recent.push({ ...metric, at: new Date().toISOString() });
  if (recent.length > 50) recent.shift();
  const snapshot = JSON.stringify({ version: app.getVersion(), samples: recent }, null, 2);
  writing = writing.then(async () => {
    const directory = app.getPath('userData');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'capture-diagnostics.json'), snapshot, 'utf8');
  }).catch(() => { /* Diagnostics must never block capture or show errors. */ });
}
