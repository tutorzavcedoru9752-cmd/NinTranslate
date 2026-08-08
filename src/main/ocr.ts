import path from 'node:path';
import { app } from 'electron';
import { createWorker, OEM, PSM, type Page } from 'tesseract.js';
import { SUPPORTED_LANGUAGES } from '../shared/language';

export interface OcrParagraph {
  text: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface OcrResult { text: string; confidence: number; paragraphs: OcrParagraph[] }

function languageDataPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ocr');
  return path.join(app.getAppPath(), 'node_modules', '@tesseract.js-data');
}

let workerPromise: ReturnType<typeof createWorker> | undefined;
let recognitionQueue: Promise<void> = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    const base = languageDataPath();
    // In development each npm data package stores its file in a versioned subfolder.
    const langPath = app.isPackaged ? base : path.join(app.getAppPath(), 'resources', 'ocr');
    workerPromise = createWorker(SUPPORTED_LANGUAGES.map(({ tesseract }) => tesseract), OEM.LSTM_ONLY, {
      langPath,
      cacheMethod: 'none'
    });
  }
  return workerPromise;
}

export async function recognizeImage(imageDataUrl: string): Promise<OcrResult> {
  const recognition = recognitionQueue.then(() => recognizeCandidates(imageDataUrl));
  recognitionQueue = recognition.then(() => undefined, () => undefined);
  return recognition;
}

async function recognizeCandidates(imageDataUrl: string): Promise<OcrResult> {
  const worker = await getWorker();
  const candidates: Array<{ tesseract: string; data: Page }> = [];
  for (const language of SUPPORTED_LANGUAGES) {
    await worker.reinitialize(language.tesseract, OEM.LSTM_ONLY);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    const result = await worker.recognize(imageDataUrl, {}, { blocks: true });
    candidates.push({ tesseract: language.tesseract, data: result.data });
  }
  const selected = selectBestCandidate(candidates);
  const paragraphs = (selected.data.blocks ?? []).flatMap((block) => block.paragraphs).map((paragraph) => ({
    text: paragraph.text.replace(/\n+$/g, '').trim(),
    confidence: paragraph.confidence,
    bounds: {
      x: paragraph.bbox.x0,
      y: paragraph.bbox.y0,
      width: paragraph.bbox.x1 - paragraph.bbox.x0,
      height: paragraph.bbox.y1 - paragraph.bbox.y0
    }
  })).filter((paragraph) => paragraph.text.length > 0);
  return {
    text: selected.data.text.replace(/\n{3,}/g, '\n\n').trim(),
    confidence: selected.data.confidence,
    paragraphs
  };
}

export function selectBestCandidate<T extends { tesseract: string; data: Pick<Page, 'confidence' | 'text'> }>(candidates: T[]): T {
  if (candidates.length === 0) throw new Error('没有可用的 OCR 语言模型。');
  const ranked = [...candidates].sort((left, right) => candidateScore(right) - candidateScore(left));
  const simplified = candidates.find(({ tesseract }) => tesseract === 'chi_sim');
  const traditional = candidates.find(({ tesseract }) => tesseract === 'chi_tra');
  if (ranked[0]?.tesseract === 'chi_tra' && simplified && traditional
      && traditional.data.confidence - simplified.data.confidence <= 20) {
    return simplified;
  }
  return ranked[0];
}

function candidateScore(candidate: { tesseract: string; data: Pick<Page, 'confidence' | 'text'> }): number {
  const text = candidate.data.text;
  let scriptBonus = 0;
  if (candidate.tesseract === 'kor') scriptBonus = /\p{Script=Hangul}/u.test(text) ? 40 : -40;
  else if (candidate.tesseract === 'rus') scriptBonus = /\p{Script=Cyrillic}/u.test(text) ? 30 : -30;
  else if (candidate.tesseract === 'jpn') scriptBonus = /[\u3040-\u30ff]/u.test(text) ? 40 : /\p{Script=Han}/u.test(text) ? 8 : -20;
  else if (candidate.tesseract === 'chi_sim' || candidate.tesseract === 'chi_tra') {
    scriptBonus = /\p{Script=Han}/u.test(text) ? 10 : -20;
  } else {
    scriptBonus = /\p{Script=Latin}/u.test(text) ? 10 : -20;
  }
  return candidate.data.confidence + scriptBonus;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = undefined;
}
