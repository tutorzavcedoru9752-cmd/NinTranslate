import type { OcrParagraph } from './ocr';

const cjkCharacter = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const sentenceEnd = /[。！？!?…；;:.]$/u;
const listStart = /^(?:[-•·●▪]|\d+[.)、]|[（(]?[一二三四五六七八九十]+[)）、.])/u;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function joinWrappedLine(previous: string, next: string): string {
  if (/\p{Script=Latin}-$/u.test(previous) && /^\p{Script=Latin}/u.test(next)) {
    return previous.slice(0, -1) + next;
  }
  const previousLast = previous.at(-1) ?? '';
  const nextFirst = next.at(0) ?? '';
  const separator = cjkCharacter.test(previousLast) || cjkCharacter.test(nextFirst) ? '' : ' ';
  return `${previous}${separator}${next}`;
}

export function buildTranslationText(paragraphs: OcrParagraph[], fallbackText: string): string {
  const lines = paragraphs
    .filter(({ text }) => text.trim())
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
  if (!lines.length) return fallbackText.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const typicalHeight = median(lines.map(({ bounds }) => bounds.height)) || 1;
  const output: string[] = [];
  let current = lines[0].text.trim();
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const next = lines[index];
    const verticalGap = next.bounds.y - (previous.bounds.y + previous.bounds.height);
    const largeGap = verticalGap > typicalHeight * 0.85;
    const startsNewItem = listStart.test(next.text.trim());
    const paragraphBreak = largeGap || startsNewItem || (sentenceEnd.test(previous.text.trim()) && verticalGap > typicalHeight * 0.4);
    if (paragraphBreak) {
      output.push(current);
      current = next.text.trim();
    } else {
      current = joinWrappedLine(current, next.text.trim());
    }
  }
  output.push(current);
  return output.join('\n\n').trim();
}
