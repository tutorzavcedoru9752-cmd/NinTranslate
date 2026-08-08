import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'resources', 'ocr');
fs.mkdirSync(output, { recursive: true });

for (const language of ['chi_sim', 'chi_tra', 'eng', 'jpn', 'kor', 'fra', 'deu', 'spa', 'por', 'rus']) {
  const packageDir = path.join(root, 'node_modules', `@tesseract.js-data/${language}`);
  const candidates = [
    path.join(packageDir, '4.0.0_best_int', `${language}.traineddata.gz`),
    path.join(packageDir, '4.0.0', `${language}.traineddata.gz`)
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) throw new Error(`Missing Tesseract language data: ${language}`);
  fs.copyFileSync(source, path.join(output, `${language}.traineddata.gz`));
}
