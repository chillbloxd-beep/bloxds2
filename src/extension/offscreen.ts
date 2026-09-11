import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import {
  findBoostStateRect,
  findCounterValueRect,
  normalizedCorrelation,
  parseHocrWords,
  type RelativeOcrRect
} from "./ocrCalibration";
import { parseBlocksMined, parseChoppingFromText, parseSidebarText, parseSkillState } from "./parser";
import type { OcrMode, OcrRequest, OcrResponse, OffscreenControlRequest, OffscreenWakeId } from "./types";

let workerPromise: Promise<Worker> | null = null;
let calibrationKey = "";
let readyTemplates: number[][] = [];
let activeTemplates: number[][] = [];
const wakeTimers = new Map<OffscreenWakeId, number>();

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function assertAsset(path: string): Promise<void> {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Bundled OCR asset is unavailable: ${path} (${response.status}).`);
}

async function resetWorker() {
  const existing = workerPromise;
  workerPromise = null;
  if (!existing) return;
  try {
    const worker = await existing;
    await worker.terminate();
  } catch {
    // A failed worker is already unusable. Clearing workerPromise is enough.
  }
}

function resetCalibration(nextKey = "") {
  calibrationKey = nextKey;
  readyTemplates = [];
  activeTemplates = [];
}

function ensureCalibrationKey(nextKey?: string) {
  const normalized = nextKey || "default";
  if (normalized !== calibrationKey) resetCalibration(normalized);
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      await Promise.all([
        assertAsset("ocr/worker.min.js"),
        assertAsset("ocr/lang/eng.traineddata.gz"),
        assertAsset("ocr/core/tesseract-core.wasm.js")
      ]);

      return await createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: chrome.runtime.getURL("ocr/worker.min.js"),
        corePath: chrome.runtime.getURL("ocr/core"),
        langPath: chrome.runtime.getURL("ocr/lang"),
        workerBlobURL: false,
        gzip: true,
        errorHandler: error => console.error("OneBlock OCR worker error:", error)
      });
    })().catch((error: unknown) => {
      workerPromise = null;
      throw new Error(`Tesseract initialization failed: ${errorText(error)}`);
    });
  }
  return workerPromise;
}

async function imageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode captured sidebar image."));
    image.src = dataUrl;
  });
}

async function preprocess(dataUrl: string, mode: OcrMode, micro: boolean): Promise<HTMLCanvasElement> {
  const image = await imageElement(dataUrl);
  // Base crops favour recognition robustness. Micro-crops contain only one
  // value token and can use less enlargement, reducing both canvas and OCR work.
  const multiplier = mode === "full" ? 1.85 : micro ? 2.0 : 2.3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * multiplier));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * multiplier));
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) throw new Error("Canvas is unavailable for OCR preprocessing.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = mode === "full"
    ? "grayscale(1) contrast(1.55) brightness(1.10)"
    : "grayscale(1) contrast(1.90) brightness(1.12)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
  return canvas;
}

function cropCanvas(source: HTMLCanvasElement, rect: RelativeOcrRect): HTMLCanvasElement {
  const sx = Math.max(0, Math.min(source.width - 1, Math.round(rect.x * source.width)));
  const sy = Math.max(0, Math.min(source.height - 1, Math.round(rect.y * source.height)));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(rect.width * source.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(rect.height * source.height)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) throw new Error("Canvas is unavailable for calibrated OCR cropping.");
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function imageSignature(source: HTMLCanvasElement): number[] {
  const width = 36;
  const height = 14;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.imageSmoothingEnabled = true;
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const values: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    values.push((pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114) / 255);
  }
  return values;
}

function rememberTemplate(label: "ready" | "active", signature: number[]) {
  if (!signature.length) return;
  const target = label === "ready" ? readyTemplates : activeTemplates;
  if (target.some(existing => normalizedCorrelation(existing, signature) >= 0.995)) return;
  target.push(signature);
  if (target.length > 4) target.shift();
}

function fastBoostMatch(canvas: HTMLCanvasElement): { label: "ready" | "active"; score: number } | undefined {
  // Never classify from a one-sided template set. Until Tesseract has confirmed
  // at least one sample of both labels, the safe path is the Tesseract fallback.
  if (readyTemplates.length === 0 || activeTemplates.length === 0) return undefined;
  const signature = imageSignature(canvas);
  if (!signature.length) return undefined;
  const bestReady = readyTemplates.reduce((best, item) => Math.max(best, normalizedCorrelation(item, signature)), -1);
  const bestActive = activeTemplates.reduce((best, item) => Math.max(best, normalizedCorrelation(item, signature)), -1);
  const best = Math.max(bestReady, bestActive);
  const second = Math.min(bestReady, bestActive);

  // Conservative by design: a fast match is only accepted when it is almost
  // identical to a Tesseract-confirmed state and clearly separated from the
  // other state. Anything less is not authoritative.
  if (best < 0.985 || best - second < 0.03) return undefined;
  return { label: bestReady > bestActive ? "ready" : "active", score: best };
}

function parseCounterValue(text: string): number | undefined {
  const digits = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^0-9]/g, "");
  if (!digits) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

async function setRecognitionParameters(worker: Worker, mode: OcrMode, micro: boolean) {
  if (mode === "full") {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      // Explicitly clear any restrictive micro-read whitelist left on the
      // persistent worker so full before/after snapshots preserve arbitrary
      // owner/banner text as faithfully as Tesseract can read it.
      tessedit_char_whitelist: ""
    });
    return;
  }

  if (micro && mode === "counter") {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
      preserve_interword_spaces: "0",
      tessedit_char_whitelist: "0123456789OoIl|,"
    });
    return;
  }

  if (micro && mode === "boost") {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
      preserve_interword_spaces: "0",
      tessedit_char_whitelist: "ReadyACTIVEactive0123456789sSOoIl|"
    });
    return;
  }

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: "1",
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:.,%|_-/ "
  });
}

async function recognize(request: OcrRequest): Promise<OcrResponse> {
  const started = performance.now();
  ensureCalibrationKey(request.calibrationKey);
  const micro = request.inputScope === "micro";
  const canvas = await preprocess(request.imageDataUrl, request.mode, micro);

  try {
    if (request.mode === "boost" && micro && request.preferFast) {
      const match = fastBoostMatch(canvas);
      if (match) {
        const elapsedMs = Math.round(performance.now() - started);
        return {
          ok: true,
          rawText: match.label === "ready" ? "Ready" : "Active",
          confidence: match.score * 100,
          elapsedMs,
          choppingSkill: { state: match.label, raw: match.label === "ready" ? "Ready" : "Active" },
          recognitionMethod: "fast-template",
          fastAttempted: true,
          fastMatchedLabel: match.label
        };
      }
      if (request.fastOnly) {
        return {
          ok: true,
          rawText: "",
          elapsedMs: Math.round(performance.now() - started),
          choppingSkill: { state: "unknown", raw: "fast template miss" },
          fastAttempted: true
        };
      }
    }

    const worker = await getWorker();
    await setRecognitionParameters(worker, request.mode, micro);
    const needsHocr = !micro && request.mode !== "full";
    const result = await worker.recognize(canvas, {}, needsHocr ? { text: true, hocr: true } : { text: true });
    const rawText = result.data.text || "";
    const confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : undefined;
    const elapsedMs = Math.round(performance.now() - started);
    const recognitionMethod = micro ? "tesseract-micro" as const : "tesseract-base" as const;

    if (request.mode === "full") {
      return {
        ok: true,
        rawText,
        confidence,
        elapsedMs,
        recognitionMethod,
        fastAttempted: false,
        snapshot: parseSidebarText(rawText, confidence)
      };
    }

    if (request.mode === "counter") {
      const blocksMined = micro ? parseCounterValue(rawText) : parseBlocksMined(rawText);
      let microRect: RelativeOcrRect | undefined;
      if (!micro) {
        const hocr = result.data.hocr;
        microRect = findCounterValueRect(parseHocrWords(hocr), canvas.width, canvas.height);
      }
      return {
        ok: true,
        rawText,
        confidence,
        elapsedMs,
        recognitionMethod,
        fastAttempted: false,
        blocksMined,
        microRect
      };
    }

    const choppingSkill = micro ? parseSkillState(rawText) : parseChoppingFromText(rawText);
    let microRect: RelativeOcrRect | undefined;
    if (!micro) {
      const hocr = result.data.hocr;
      microRect = findBoostStateRect(parseHocrWords(hocr), canvas.width, canvas.height);
      if (microRect && (choppingSkill.state === "ready" || choppingSkill.state === "active") && (confidence ?? 0) >= 70) {
        const signatureCanvas = cropCanvas(canvas, microRect);
        rememberTemplate(choppingSkill.state, imageSignature(signatureCanvas));
      }
    } else if ((choppingSkill.state === "ready" || choppingSkill.state === "active") && (confidence ?? 0) >= 70) {
      rememberTemplate(choppingSkill.state, imageSignature(canvas));
    }

    return {
      ok: true,
      rawText,
      confidence,
      elapsedMs,
      recognitionMethod,
      fastAttempted: Boolean(request.preferFast),
      choppingSkill,
      microRect
    };
  } catch (error) {
    await resetWorker();
    throw new Error(`Tesseract recognition failed: ${errorText(error)}`);
  }
}

function cancelWake(id: OffscreenWakeId) {
  const handle = wakeTimers.get(id);
  if (handle !== undefined) window.clearTimeout(handle);
  wakeTimers.delete(id);
}

function scheduleWake(id: OffscreenWakeId, when: number) {
  cancelWake(id);
  const delayMs = Math.max(0, when - Date.now());
  const handle = window.setTimeout(() => {
    wakeTimers.delete(id);
    void chrome.runtime.sendMessage({ target: "background", type: "OFFSCREEN_WAKE", id }).catch(() => {
      // A transient service-worker startup failure is covered by the Chrome
      // alarm/status-poll fallbacks; avoid an unhandled offscreen rejection.
    });
  }, Math.min(delayMs, 2_147_000_000));
  wakeTimers.set(id, handle);
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const control = message as OffscreenControlRequest;
  if (control?.target === "offscreen" && control.type === "SCHEDULE_WAKE") {
    scheduleWake(control.id, control.when);
    sendResponse({ ok: true });
    return false;
  }
  if (control?.target === "offscreen" && control.type === "CANCEL_WAKE") {
    cancelWake(control.id);
    sendResponse({ ok: true });
    return false;
  }
  if (control?.target === "offscreen" && control.type === "RESET_CALIBRATION") {
    resetCalibration();
    sendResponse({ ok: true });
    return false;
  }

  const request = message as OcrRequest;
  if (request?.target !== "offscreen" || request.type !== "OCR") return undefined;

  void recognize(request)
    .then(sendResponse)
    .catch((error: unknown) => {
      const response: OcrResponse = {
        ok: false,
        error: errorText(error) || "OCR failed."
      };
      sendResponse(response);
    });

  return true;
});
