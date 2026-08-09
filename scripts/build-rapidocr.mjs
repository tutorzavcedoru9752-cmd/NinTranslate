import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.RAPIDOCR_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3');
const runtimeKey = `${process.platform}-${process.arch}`;
const distPath = path.join(root, 'resources', 'rapidocr', 'runtime', runtimeKey);
const workPath = path.join(root, 'build', 'rapidocr', runtimeKey);
fs.mkdirSync(distPath, { recursive: true });
fs.mkdirSync(workPath, { recursive: true });

const result = spawnSync(python, [
  '-m', 'PyInstaller',
  path.join(root, 'scripts', 'rapidocr_sidecar.py'),
  '--name', 'rapidocr-sidecar',
  '--onedir', '--noconfirm', '--clean',
  '--distpath', distPath,
  '--workpath', workPath,
  '--specpath', workPath,
  '--collect-data', 'rapidocr',
  '--collect-submodules', 'rapidocr.inference_engine.onnxruntime',
  '--collect-data', 'rapid_layout',
  '--collect-submodules', 'rapid_layout.inference_engine.onnxruntime',
  '--exclude-module', 'torch',
  '--exclude-module', 'paddle',
  '--exclude-module', 'openvino',
  '--exclude-module', 'tensorrt'
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PYINSTALLER_CONFIG_DIR: path.join(root, 'build', 'rapidocr', 'cache') }
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// RapidOCR ships its own default PP-OCRv4 model copies. NinTranslate always
// points it at the separately verified PP-OCRv5 models in resources, so keeping
// the defaults would add about 16 MB without ever being used.
const bundledModelRoots = [
  path.join(distPath, 'rapidocr-sidecar', '_internal', 'rapidocr', 'models'),
  path.join(distPath, 'rapidocr-sidecar', '_internal', 'rapid_layout')
];
let removedBytes = 0;
for (const bundledModelRoot of bundledModelRoots) {
  if (fs.existsSync(bundledModelRoot)) {
    for (const entry of fs.readdirSync(bundledModelRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.onnx') continue;
      const modelPath = path.join(entry.parentPath, entry.name);
      removedBytes += fs.statSync(modelPath).size;
      fs.unlinkSync(modelPath);
    }
  }
}

console.log(`RapidOCR runtime built for ${runtimeKey}; removed ${removedBytes} bytes of unused default models.`);
