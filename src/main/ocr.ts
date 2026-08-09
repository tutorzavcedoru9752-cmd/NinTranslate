import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

export interface OcrParagraph {
  text: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
  layoutBlockId?: string;
  layoutType?: 'text' | 'title' | 'figure' | 'table' | 'caption' | 'equation';
  hardBreakBefore?: boolean;
}

export interface OcrResult {
  text: string;
  confidence: number;
  paragraphs: OcrParagraph[];
  modelGroup?: 'cjk' | 'korean' | 'latin' | 'cyrillic';
  layoutApplied: boolean;
  layoutElapsedMs: number;
  highAccuracyApplied?: boolean;
}

interface SidecarResponse {
  type?: 'ready';
  id?: string;
  ok?: boolean;
  result?: OcrResult;
  error?: string;
}

interface PendingRequest {
  resolve: (value: OcrResult) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

let sidecar: ChildProcessWithoutNullStreams | undefined;
let readyPromise: Promise<void> | undefined;
let stdoutBuffer = '';
const pending = new Map<string, PendingRequest>();

function rapidOcrRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'rapidocr')
    : path.join(app.getAppPath(), 'resources', 'rapidocr');
}

function executablePath(): string {
  if (process.env.NINTRANSLATE_RAPIDOCR_EXECUTABLE) {
    return path.resolve(process.env.NINTRANSLATE_RAPIDOCR_EXECUTABLE);
  }
  const executable = process.platform === 'win32' ? 'rapidocr-sidecar.exe' : 'rapidocr-sidecar';
  return path.join(rapidOcrRoot(), 'runtime', `${process.platform}-${process.arch}`, 'rapidocr-sidecar', executable);
}

function rejectAll(message: string): void {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error(message));
  }
  pending.clear();
}

function handleResponse(line: string, markReady: () => void): void {
  if (!line.trim()) return;
  let response: SidecarResponse;
  try { response = JSON.parse(line) as SidecarResponse; }
  catch { return; }
  if (response.type === 'ready') {
    markReady();
    return;
  }
  if (!response.id) return;
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  clearTimeout(request.timeout);
  if (response.ok && response.result) request.resolve(response.result);
  else request.reject(new Error(response.error || '本地文字识别失败。'));
}

function startSidecar(): Promise<void> {
  if (sidecar && readyPromise) return readyPromise;
  const executable = executablePath();
  readyPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      resolve();
    };
    const failStartup = (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(startupTimeout);
        reject(error);
      }
    };
    const startupTimeout = setTimeout(() => {
      failStartup(new Error('本地 RapidOCR 引擎启动超时，请重新启动应用。'));
      sidecar?.kill();
    }, 20_000);
    sidecar = spawn(executable, [], {
      windowsHide: true,
      env: {
        ...process.env,
        NINTRANSLATE_OCR_MODEL_DIR: path.join(rapidOcrRoot(), 'models'),
        PYTHONIOENCODING: 'utf-8'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    sidecar.stdout.setEncoding('utf8');
    sidecar.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) handleResponse(line, markReady);
    });
    sidecar.stderr.setEncoding('utf8');
    sidecar.stderr.on('data', (chunk: string) => console.warn(`[RapidOCR] ${chunk.trim()}`));
    sidecar.on('error', (error) => {
      const wrapped = error.message.includes('ENOENT')
        ? new Error('未找到随应用提供的 RapidOCR 本地引擎，请重新安装 NinTranslate。')
        : new Error(`RapidOCR 无法启动：${error.message}`);
      failStartup(wrapped);
      rejectAll(wrapped.message);
      sidecar = undefined;
      readyPromise = undefined;
    });
    sidecar.on('exit', (code) => {
      const message = code === 0 ? 'RapidOCR 已停止。' : `RapidOCR 意外退出（代码 ${code ?? '未知'}）。`;
      failStartup(new Error(message));
      rejectAll(message);
      sidecar = undefined;
      readyPromise = undefined;
      stdoutBuffer = '';
    });
  });
  return readyPromise;
}

export async function recognizeImage(imageDataUrl: string): Promise<OcrResult> {
  await startSidecar();
  const processHandle = sidecar;
  if (!processHandle || processHandle.killed) throw new Error('RapidOCR 本地引擎不可用。');
  const id = randomUUID();
  return new Promise<OcrResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('本地文字识别超时，请缩小截图范围后重试。'));
    }, 120_000);
    pending.set(id, { resolve, reject, timeout });
    processHandle.stdin.write(`${JSON.stringify({ id, action: 'recognize', imageData: imageDataUrl })}\n`, (error) => {
      if (!error) return;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      clearTimeout(request.timeout);
      request.reject(new Error(`无法向 RapidOCR 发送截图：${error.message}`));
    });
  });
}

export async function terminateOcr(): Promise<void> {
  if (!sidecar) return;
  const processHandle = sidecar;
  sidecar = undefined;
  readyPromise = undefined;
  rejectAll('应用正在退出，文字识别已取消。');
  processHandle.stdin.end();
  processHandle.kill();
}
