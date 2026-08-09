import type { TextFlowMode } from '../shared/types';
import type { OcrParagraph } from './ocr';

const cjkCharacter = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const sentenceEnd = /[。！？!?…；;:.]$/u;
const listStart = /^(?:[-•·●▪]|\d+[.)、]|[（(]?[一二三四五六七八九十]+[)）、.])/u;
const retainedCompoundPrefixes = new Set([
  'billion', 'million', 'multi', 'non', 'real', 'self', 'user', 'well', 'high', 'low', 'long', 'short'
]);

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function joinWrappedLine(previous: string, next: string): string {
  if (/\p{Script=Latin}-$/u.test(previous) && /^\p{Script=Latin}/u.test(next)) {
    const prefix = previous.match(/([\p{Script=Latin}]+)-$/u)?.[1].toLocaleLowerCase();
    if (prefix && retainedCompoundPrefixes.has(prefix)) return previous + next;
    return previous.slice(0, -1) + next;
  }
  const previousLast = previous.at(-1) ?? '';
  const nextFirst = next.at(0) ?? '';
  const separator = cjkCharacter.test(previousLast) || cjkCharacter.test(nextFirst) ? '' : ' ';
  return `${previous}${separator}${next}`;
}

function joinOverlappingFragments(previous: string, next: string): string {
  const previousLower = previous.toLocaleLowerCase();
  const nextLower = next.toLocaleLowerCase();
  if (previousLower.includes(nextLower)) return previous;
  if (nextLower.includes(previousLower)) return next;
  const maximum = Math.min(previous.length, next.length, 12);
  for (let length = maximum; length >= 1; length -= 1) {
    if (previousLower.slice(-length) === nextLower.slice(0, length)) {
      return previous + next.slice(length);
    }
  }
  return joinWrappedLine(previous, next);
}

function intervalOverlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function verticalOverlapRatio(left: OcrParagraph, right: OcrParagraph): number {
  const overlap = intervalOverlap(
    left.bounds.y,
    left.bounds.y + left.bounds.height,
    right.bounds.y,
    right.bounds.y + right.bounds.height
  );
  return overlap / Math.max(1, Math.min(left.bounds.height, right.bounds.height));
}

function combineFragments(fragments: OcrParagraph[]): OcrParagraph {
  const ordered = [...fragments].sort((left, right) => left.bounds.x - right.bounds.x);
  const left = Math.min(...ordered.map(({ bounds }) => bounds.x));
  const top = Math.min(...ordered.map(({ bounds }) => bounds.y));
  const right = Math.max(...ordered.map(({ bounds }) => bounds.x + bounds.width));
  const bottom = Math.max(...ordered.map(({ bounds }) => bounds.y + bounds.height));
  const layoutIds = new Set(ordered.map(({ layoutBlockId }) => layoutBlockId).filter(Boolean));
  const layoutTypes = new Set(ordered.map(({ layoutType }) => layoutType).filter(Boolean));
  let text = ordered[0].text.trim();
  let rightEdge = ordered[0].bounds.x + ordered[0].bounds.width;
  for (const fragment of ordered.slice(1)) {
    text = fragment.bounds.x < rightEdge
      ? joinOverlappingFragments(text, fragment.text.trim())
      : joinWrappedLine(text, fragment.text.trim());
    rightEdge = Math.max(rightEdge, fragment.bounds.x + fragment.bounds.width);
  }
  const weightedLength = ordered.reduce((sum, item) => sum + Math.max(1, item.text.length), 0);
  return {
    text,
    confidence: ordered.reduce(
      (sum, item) => sum + item.confidence * Math.max(1, item.text.length),
      0
    ) / weightedLength,
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    layoutBlockId: layoutIds.size === 1 ? [...layoutIds][0] : undefined,
    layoutType: layoutTypes.size === 1 ? [...layoutTypes][0] : undefined,
    hardBreakBefore: ordered.some(({ hardBreakBefore }) => hardBreakBefore)
  };
}

/**
 * OCR engines occasionally return several word boxes for one visible line.
 * Reconstruct those fragments before looking for columns; otherwise a gap
 * between two words can be mistaken for a page-wide column gutter.
 */
function reconstructVisualLines(lines: OcrParagraph[], typicalHeight: number): OcrParagraph[] {
  const rows: OcrParagraph[][] = [];
  for (const line of [...lines].sort((left, right) =>
    left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x
  )) {
    let bestRow: OcrParagraph[] | undefined;
    let bestOverlap = 0;
    for (const row of rows) {
      const overlap = Math.max(...row.map((item) => verticalOverlapRatio(item, line)));
      const rowCenter = median(row.map(({ bounds }) => bounds.y + bounds.height / 2));
      const lineCenter = line.bounds.y + line.bounds.height / 2;
      const sameBaseline = Math.abs(rowCenter - lineCenter) <= typicalHeight * 0.42;
      if ((overlap >= 0.45 || sameBaseline) && overlap + Number(sameBaseline) > bestOverlap) {
        bestRow = row;
        bestOverlap = overlap + Number(sameBaseline);
      }
    }
    if (bestRow) bestRow.push(line);
    else rows.push([line]);
  }

  const rebuilt: OcrParagraph[] = [];
  for (const row of rows) {
    const ordered = [...row].sort((left, right) => left.bounds.x - right.bounds.x);
    let fragments = [ordered[0]];
    let rightEdge = ordered[0].bounds.x + ordered[0].bounds.width;
    for (const item of ordered.slice(1)) {
      const gap = item.bounds.x - rightEdge;
      // A normal inter-word gap is small relative to the text height. A real
      // column gutter is deliberately kept as a separate segment.
      if (gap <= typicalHeight * 1.5) fragments.push(item);
      else {
        rebuilt.push(combineFragments(fragments));
        fragments = [item];
      }
      rightEdge = Math.max(rightEdge, item.bounds.x + item.bounds.width);
    }
    rebuilt.push(combineFragments(fragments));
  }
  return rebuilt;
}

interface XInterval { start: number; end: number }

function persistentGutters(lines: OcrParagraph[], typicalHeight: number): Array<{ gap: number; cut: number }> {
  const intervals: XInterval[] = lines
    .map(({ bounds }) => ({ start: bounds.x, end: bounds.x + bounds.width }))
    .sort((left, right) => left.start - right.start);
  if (!intervals.length) return [];
  const merged: XInterval[] = [{ ...intervals[0] }];
  for (const interval of intervals.slice(1)) {
    const current = merged[merged.length - 1];
    if (interval.start <= current.end + typicalHeight * 0.25) {
      current.end = Math.max(current.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.slice(0, -1).map((interval, index) => {
    const next = merged[index + 1];
    return { gap: next.start - interval.end, cut: interval.end + (next.start - interval.end) / 2 };
  }).filter(({ gap }) => gap >= typicalHeight * 2.2).sort((left, right) => right.gap - left.gap);
}

function xyCutOrder(lines: OcrParagraph[], typicalHeight: number): OcrParagraph[] {
  if (lines.length <= 1) return lines;
  // A column boundary must be a persistent blank gutter across the union of
  // all text boxes. Varying line lengths alone can no longer create a column.
  for (const gutter of persistentGutters(lines, typicalHeight)) {
    const left = lines.filter(({ bounds }) => bounds.x + bounds.width / 2 < gutter.cut);
    const right = lines.filter(({ bounds }) => bounds.x + bounds.width / 2 >= gutter.cut);
    if (left.length < 2 || right.length < 2) continue;
    const leftTop = Math.min(...left.map(({ bounds }) => bounds.y));
    const leftBottom = Math.max(...left.map(({ bounds }) => bounds.y + bounds.height));
    const rightTop = Math.min(...right.map(({ bounds }) => bounds.y));
    const rightBottom = Math.max(...right.map(({ bounds }) => bounds.y + bounds.height));
    const overlap = intervalOverlap(leftTop, leftBottom, rightTop, rightBottom);
    const shorterSpan = Math.max(1, Math.min(leftBottom - leftTop, rightBottom - rightTop));
    if (overlap / shorterSpan >= 0.5) {
      const orderedLeft = xyCutOrder(left, typicalHeight);
      const orderedRight = xyCutOrder(right, typicalHeight);
      if (orderedRight.length) orderedRight[0] = { ...orderedRight[0], hardBreakBefore: true };
      return [...orderedLeft, ...orderedRight];
    }
  }
  return [...lines].sort((left, right) => {
    const leftCenter = left.bounds.y + left.bounds.height / 2;
    const rightCenter = right.bounds.y + right.bounds.height / 2;
    return Math.abs(leftCenter - rightCenter) <= typicalHeight * 0.42
      ? left.bounds.x - right.bounds.x
      : leftCenter - rightCenter;
  });
}

function orderedVisualLines(paragraphs: OcrParagraph[]): { lines: OcrParagraph[]; typicalHeight: number } {
  const visible = paragraphs.filter(({ text }) => text.trim());
  const typicalHeight = median(visible.map(({ bounds }) => bounds.height)) || 1;
  return { lines: xyCutOrder(reconstructVisualLines(visible, typicalHeight), typicalHeight), typicalHeight };
}

export function buildTranslationText(
  paragraphs: OcrParagraph[],
  fallbackText: string,
  mode: TextFlowMode = 'smart'
): string {
  const { lines, typicalHeight } = orderedVisualLines(paragraphs);
  if (!lines.length) {
    const normalized = fallbackText.replace(/\r\n?/g, '\n').trim();
    return mode === 'preserve' ? normalized : normalized.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ');
  }
  if (mode === 'preserve') return lines.map(({ text }) => text.trim()).join('\n');
  if (mode === 'merge') {
    return lines.slice(1).reduce((text, line) => joinWrappedLine(text, line.text.trim()), lines[0].text.trim());
  }

  const output: string[] = [];
  let current = lines[0].text.trim();
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const next = lines[index];
    const verticalGap = next.bounds.y - (previous.bounds.y + previous.bounds.height);
    const largeGap = verticalGap > typicalHeight * 0.85;
    const startsNewItem = listStart.test(next.text.trim());
    const layoutBreak = Boolean(
      previous.layoutBlockId && next.layoutBlockId
      && previous.layoutBlockId !== next.layoutBlockId
      && previous.layoutType && next.layoutType
      && previous.layoutType !== next.layoutType
    );
    const paragraphBreak = Boolean(next.hardBreakBefore) || layoutBreak || largeGap || startsNewItem
      || (sentenceEnd.test(previous.text.trim()) && verticalGap > typicalHeight * 0.4);
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
