import path from 'node:path';
import { app } from 'electron';
import { createWorker, OEM, PSM } from 'tesseract.js';

export interface OcrResult { text: string; confidence: number }

function languageDataPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ocr');
  return path.join(app.getAppPath(), 'node_modules', '@tesseract.js-data');
}

let workerPromise: ReturnType<typeof createWorker> | undefined;

async function getWorker() {
  if (!workerPromise) {
    const base = languageDataPath();
    // In development each npm data package stores its file in a versioned subfolder.
    const langPath = app.isPackaged ? base : path.join(app.getAppPath(), 'resources', 'ocr');
    workerPromise = createWorker(['eng', 'chi_sim'], OEM.LSTM_ONLY, { langPath });
  }
  const worker = await workerPromise;
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
  return worker;
}

export async function recognizeImage(imageDataUrl: string): Promise<OcrResult> {
  const worker = await getWorker();
  const result = await worker.recognize(imageDataUrl);
  return { text: result.data.text.replace(/\n{3,}/g, '\n\n').trim(), confidence: result.data.confidence };
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = undefined;
}
