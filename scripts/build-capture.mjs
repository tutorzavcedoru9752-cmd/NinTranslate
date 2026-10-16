import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.join(root, 'resources', 'capture', 'win32-x64');
  const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  fs.mkdirSync(output, { recursive: true });
  const result = spawnSync(compiler, ['/nologo', '/optimize+', '/platform:x64', '/target:exe',
    `/out:${path.join(output, 'screen-capture.exe')}`, path.join(root, 'scripts', 'native', 'ScreenCapture.cs')], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const overlay = spawnSync(compiler, ['/nologo', '/optimize+', '/platform:x64', '/target:exe',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
    `/out:${path.join(output, 'screen-overlay.exe')}`, path.join(root, 'scripts', 'native', 'ScreenOverlay.cs')], { stdio: 'inherit', windowsHide: true });
  if (overlay.error) throw overlay.error;
  if (overlay.status !== 0) process.exit(overlay.status ?? 1);
  console.log('Built Windows native screen capture helper.');
}
