export interface RelativeOcrRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HocrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function decodeSimpleHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

/**
 * Parse only Tesseract word spans. hOCR nests `ocrx_word` spans inside line
 * spans, so the matcher deliberately accepts only spans whose body contains no
 * child tag. A generic nested-span regex can consume an entire line up to the
 * first word's closing tag and silently skip that first word.
 */
export function parseHocrWords(hocr?: string | null): HocrWord[] {
  if (!hocr) return [];
  const words: HocrWord[] = [];
  const spanPattern = /<span\b([^>]*)>([^<]*)<\/span>/gi;
  let match: RegExpExecArray | null;
  while ((match = spanPattern.exec(hocr))) {
    const attributes = match[1];
    if (!/\bocrx_word\b/i.test(attributes)) continue;
    const bbox = attributes.match(/\bbbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
    if (!bbox) continue;
    const text = decodeSimpleHtml(match[2]);
    if (!text) continue;
    const [x0, y0, x1, y1] = bbox.slice(1).map(Number);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) continue;
    words.push({ text, x0, y0, x1, y1 });
  }
  return words;
}

function normalizedRect(
  word: HocrWord,
  imageWidth: number,
  imageHeight: number,
  options: { padX: number; padY: number; minWidth: number; minHeight: number }
): RelativeOcrRect | undefined {
  if (imageWidth <= 0 || imageHeight <= 0) return undefined;
  const wordWidth = word.x1 - word.x0;
  const wordHeight = word.y1 - word.y0;
  const targetWidth = Math.max(wordWidth * (1 + options.padX * 2), imageWidth * options.minWidth);
  const targetHeight = Math.max(wordHeight * (1 + options.padY * 2), imageHeight * options.minHeight);
  const centerX = (word.x0 + word.x1) / 2;
  const centerY = (word.y0 + word.y1) / 2;
  const left = Math.max(0, Math.min(imageWidth - targetWidth, centerX - targetWidth / 2));
  const top = Math.max(0, Math.min(imageHeight - targetHeight, centerY - targetHeight / 2));
  const width = Math.min(imageWidth - left, targetWidth);
  const height = Math.min(imageHeight - top, targetHeight);
  return {
    x: left / imageWidth,
    y: top / imageHeight,
    width: width / imageWidth,
    height: height / imageHeight
  };
}

/**
 * Chopping's changing value (`Ready`, `Active`, `153s`, ...) is not a stable
 * calibration anchor. The literal `Skill:` label immediately to its left is.
 * Capture the stable label AND its value as one small line. The extra context
 * costs little compared with the base Chopping crop but is substantially more
 * robust than OCRing a value-only sliver at different UI scales.
 */
function normalizedSkillCellRect(
  skillAnchor: HocrWord,
  imageWidth: number,
  imageHeight: number
): RelativeOcrRect | undefined {
  if (imageWidth <= 0 || imageHeight <= 0) return undefined;
  const wordHeight = Math.max(1, skillAnchor.y1 - skillAnchor.y0);
  const left = Math.max(0, skillAnchor.x0 - wordHeight * 0.25);
  const targetWidth = Math.min(imageWidth - left, imageWidth * 0.50);
  const targetHeight = Math.min(imageHeight, Math.max(imageHeight * 0.30, wordHeight * 3.0));
  const centerY = (skillAnchor.y0 + skillAnchor.y1) / 2;
  const top = Math.max(0, Math.min(imageHeight - targetHeight, centerY - targetHeight / 2));
  return {
    x: left / imageWidth,
    y: top / imageHeight,
    width: targetWidth / imageWidth,
    height: targetHeight / imageHeight
  };
}

function resemblesChopping(value: string) {
  return /^ch[o0]pp(?:ing|lng)$/i.test(value.replace(/[^a-z0-9]/gi, ""));
}

function resemblesSkillAnchor(value: string) {
  return /^skill[:=]?$/i.test(value.replace(/\s+/g, ""));
}

export function findBoostStateRect(
  words: HocrWord[],
  imageWidth: number,
  imageHeight: number
): RelativeOcrRect | undefined {
  const chopping = words.find(word => resemblesChopping(word.text));
  if (!chopping) return undefined;
  const choppingCenterY = (chopping.y0 + chopping.y1) / 2;
  const lineHeight = Math.max(1, chopping.y1 - chopping.y0);
  const anchors = words
    .filter(word => resemblesSkillAnchor(word.text))
    .filter(word => {
      const centerY = (word.y0 + word.y1) / 2;
      return centerY >= choppingCenterY - lineHeight * 0.35
        && centerY <= choppingCenterY + lineHeight * 4.5;
    })
    .sort((a, b) => {
      const ay = Math.max(0, (a.y0 + a.y1) / 2 - choppingCenterY);
      const by = Math.max(0, (b.y0 + b.y1) / 2 - choppingCenterY);
      return ay - by || b.x0 - a.x0;
    });
  const skillAnchor = anchors[0];
  if (!skillAnchor) return undefined;
  return normalizedSkillCellRect(skillAnchor, imageWidth, imageHeight);
}

function numericTokenScore(value: string) {
  const compact = value.replace(/[,\s]/g, "");
  if (!/^[0-9OoIl|]+$/.test(compact)) return -1;
  return compact.length;
}

export function findCounterValueRect(
  words: HocrWord[],
  imageWidth: number,
  imageHeight: number
): RelativeOcrRect | undefined {
  const mined = words.find(word => /^mined[:=]?$/i.test(word.text.replace(/\s+/g, "")));
  let candidates = words.filter(word => numericTokenScore(word.text) >= 1);
  if (mined) {
    const minedCenterY = (mined.y0 + mined.y1) / 2;
    const lineHeight = Math.max(1, mined.y1 - mined.y0);
    candidates = candidates.filter(word => {
      const centerY = (word.y0 + word.y1) / 2;
      return word.x0 >= mined.x0 && Math.abs(centerY - minedCenterY) <= lineHeight * 1.1;
    });
  }
  candidates.sort((a, b) => numericTokenScore(b.text) - numericTokenScore(a.text) || b.x0 - a.x0);
  const value = candidates[0];
  if (!value) return undefined;
  return normalizedRect(value, imageWidth, imageHeight, {
    padX: 0.25,
    padY: 0.6,
    minWidth: 0.22,
    minHeight: 0.2
  });
}

export function normalizedCorrelation(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    dot += da * db;
    normA += da * da;
    normB += db * db;
  }
  if (normA <= 1e-9 || normB <= 1e-9) return -1;
  return dot / Math.sqrt(normA * normB);
}
