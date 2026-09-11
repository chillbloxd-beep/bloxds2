import { describe, expect, it } from "vitest";
import {
  findBoostStateRect,
  findCounterValueRect,
  normalizedCorrelation,
  parseHocrWords
} from "./ocrCalibration";

const fixture = `
<div class='ocr_page' title='bbox 0 0 400 240'>
  <span class='ocr_line' title='bbox 10 10 300 40'>
    <span class='ocrx_word' title='bbox 10 10 95 35'>Blocks</span>
    <span class='ocrx_word' title='bbox 105 10 175 35'>mined:</span>
    <span class='ocrx_word' title='bbox 190 10 285 35'>1644300</span>
  </span>
  <span class='ocr_line' title='bbox 10 80 320 105'>
    <span class='ocrx_word' title='bbox 10 80 110 105'>Chopping</span>
  </span>
  <span class='ocr_line' title='bbox 10 115 370 145'>
    <span class='ocrx_word' title='bbox 15 115 75 140'>Lucky:</span>
    <span class='ocrx_word' title='bbox 220 115 265 140'>Skill:</span>
    <span class='ocrx_word' title='bbox 275 115 350 140'>Ready</span>
  </span>
</div>`;

describe("parseHocrWords", () => {
  it("extracts word text and bounding boxes", () => {
    const words = parseHocrWords(fixture);
    expect(words.some(word => word.text === "Chopping" && word.x0 === 10 && word.y0 === 80)).toBe(true);
    expect(words.some(word => word.text === "1644300")).toBe(true);
  });
});

describe("micro crop discovery", () => {
  it("finds a padded Chopping state crop", () => {
    const rect = findBoostStateRect(parseHocrWords(fixture), 400, 240);
    expect(rect).toBeDefined();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(1);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(1);
  });

  it("finds the Blocks mined number crop", () => {
    const rect = findCounterValueRect(parseHocrWords(fixture), 400, 240);
    expect(rect).toBeDefined();
    expect(rect!.x).toBeGreaterThan(0.3);
    expect(rect!.width).toBeGreaterThan(0.2);
  });
});

describe("normalizedCorrelation", () => {
  it("scores identical patterns above unrelated ones", () => {
    const a = [0, 1, 2, 3, 2, 1, 0];
    const b = [0, 1, 2, 3, 2, 1, 0];
    const c = [3, 0, 1, 0, 1, 0, 3];
    expect(normalizedCorrelation(a, b)).toBeCloseTo(1, 8);
    expect(normalizedCorrelation(a, c)).toBeLessThan(0.5);
  });
});
