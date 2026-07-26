import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, OEM, PSM } from 'tesseract.js';

const imagePath = process.argv[2];
if (!imagePath) throw new Error('Usage: node scripts/smoke-ocr.mjs <image-path>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = await createWorker(['eng', 'chi_sim'], OEM.LSTM_ONLY, { langPath: path.join(root, 'resources', 'ocr') });
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
const result = await worker.recognize(path.resolve(imagePath));
await worker.terminate();
console.log(JSON.stringify({ text: result.data.text.trim(), confidence: result.data.confidence }));
