import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, OEM, PSM } from 'tesseract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const langPath = path.join(root, 'resources', 'ocr');
const fixtures = [
  ['chi_sim', 'zh-Hans'], ['chi_tra', 'zh-Hant'], ['eng', 'en'], ['jpn', 'ja'], ['kor', 'ko'],
  ['fra', 'fr'], ['deu', 'de'], ['spa', 'es'], ['por', 'pt'], ['rus', 'ru']
];

const worker = await createWorker(fixtures.map(([language]) => language), OEM.LSTM_ONLY, { langPath });
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' });
for (const [, code] of fixtures) {
  const candidates = [];
  const imagePath = path.join(root, 'src', 'main', '__fixtures__', 'ocr', `${code}.png`);
  for (const [language] of fixtures) {
    await worker.reinitialize(language, OEM.LSTM_ONLY);
    const result = await worker.recognize(imagePath);
    candidates.push({ language, confidence: result.data.confidence, text: result.data.text.trim() });
  }
  candidates.sort((left, right) => right.confidence - left.confidence);
  console.log(JSON.stringify({ code, candidates: candidates.slice(0, code.startsWith('zh-') ? 10 : 3) }));
}
await worker.terminate();
