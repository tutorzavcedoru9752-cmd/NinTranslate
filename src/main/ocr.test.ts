import { describe, expect, it } from 'vitest';
import { selectBestCandidate } from './ocr';

describe('OCR candidate selection', () => {
  it('uses the highest-confidence language model', () => {
    const candidates = [
      { tesseract: 'eng', data: { confidence: 55, text: 'Perevod' } },
      { tesseract: 'rus', data: { confidence: 94, text: 'Перевод' } }
    ];
    expect(selectBestCandidate(candidates).tesseract).toBe('rus');
  });

  it('prefers Simplified Chinese when Chinese models are close', () => {
    const candidates = [
      { tesseract: 'chi_sim', data: { confidence: 51, text: '截图翻译' } },
      { tesseract: 'chi_tra', data: { confidence: 62, text: '截嬲翻譯' } }
    ];
    expect(selectBestCandidate(candidates).tesseract).toBe('chi_sim');
  });

  it('keeps Traditional Chinese when its confidence is decisive', () => {
    const candidates = [
      { tesseract: 'chi_sim', data: { confidence: 24, text: '董幕翻译' } },
      { tesseract: 'chi_tra', data: { confidence: 95, text: '螢幕翻譯' } }
    ];
    expect(selectBestCandidate(candidates).tesseract).toBe('chi_tra');
  });

  it('rewards a model that produces its own distinctive script', () => {
    const candidates = [
      { tesseract: 'jpn', data: { confidence: 90, text: '五本' } },
      { tesseract: 'kor', data: { confidence: 70, text: '화면 번역' } }
    ];
    expect(selectBestCandidate(candidates).tesseract).toBe('kor');
  });
});
