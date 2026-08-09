import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelDirectory = path.join(root, 'resources', 'rapidocr', 'models');
const expected = new Map([
  ['ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx', '54379ae5174d026780215fc748a7f31910dee36818e63d49e17dc598ecc82df7'],
  ['ch_PP-OCRv5_det_mobile.onnx', '4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae'],
  ['ch_PP-OCRv5_rec_mobile.onnx', '5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5'],
  ['ch_PP-OCRv5_rec_server.onnx', 'e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a'],
  ['eslav_PP-OCRv5_rec_mobile.onnx', '08705d6721849b1347d26187f15a5e362c431963a2a62bfff4feac578c489aab'],
  ['korean_PP-OCRv5_rec_mobile.onnx', 'cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b'],
  ['latin_PP-OCRv5_rec_mobile.onnx', 'b20bd37c168a570f583afbc8cd7925603890efbcdc000a59e22c269d160b5f5a'],
  ['layout_cdla.onnx', '25b1f27ec56aa932a48f30cbd6293c358a156280f4b20b0a973bab210c39f62c'],
  ['layout_publaynet.onnx', '958aa6dcef1cc1a542d0a513b5976a3d5edbcc37d76460ec1e9f126358e4d100']
]);

for (const [filename, expectedHash] of expected) {
  const modelPath = path.join(modelDirectory, filename);
  if (!fs.existsSync(modelPath)) throw new Error(`Missing RapidOCR model: ${filename}`);
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`RapidOCR model checksum mismatch: ${filename}`);
}

if (process.env.REQUIRE_RAPIDOCR_RUNTIME === '1') {
  const executable = process.platform === 'win32' ? 'rapidocr-sidecar.exe' : 'rapidocr-sidecar';
  const runtimePath = path.join(
    root, 'resources', 'rapidocr', 'runtime', `${process.platform}-${process.arch}`, 'rapidocr-sidecar', executable
  );
  if (!fs.existsSync(runtimePath)) throw new Error(`Missing RapidOCR runtime: ${runtimePath}`);
}

console.log(`Verified ${expected.size} local OCR and layout model files.`);
