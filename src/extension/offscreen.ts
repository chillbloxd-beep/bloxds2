import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { parseBlocksMined, parseChoppingFromText, parseSidebarText } from "./parser";
import type { OcrMode, OcrRequest, OcrResponse } from "./types";

let workerPromise: Promise<Worker> | null = null;

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

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      await Promise.all([
        assertAsset("ocr/worker.min.js"),
        assertAsset("ocr/lang/eng.traineddata.gz")
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

async function preprocess(dataUrl: string, mode: OcrMode): Promise<HTMLCanvasElement> {
  const image = await imageElement(dataUrl);
  const multiplier = mode === "full" ? 1.65 : 2.15;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * multiplier));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * multiplier));
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) throw new Error("Canvas is unavailable for OCR preprocessing.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = mode === "full"
    ? "grayscale(1) contrast(1.45) brightness(1.12)"
    : "grayscale(1) contrast(1.75) brightness(1.16)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
  return canvas;
}

async function recognize(request: OcrRequest): Promise<OcrResponse> {
  const started = performance.now();
  const worker = await getWorker();
  const canvas = await preprocess(request.imageDataUrl, request.mode);

  await worker.setParameters({
    tessedit_pageseg_mode: request.mode === "full" ? PSM.SPARSE_TEXT : PSM.SINGLE_BLOCK,
    preserve_interword_spaces: "1"
  });

  const result = await worker.recognize(canvas);
  const rawText = result.data.text || "";
  const confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : undefined;
  const elapsedMs = Math.round(performance.now() - started);

  if (request.mode === "full") {
    return {
      ok: true,
      rawText,
      confidence,
      elapsedMs,
      snapshot: parseSidebarText(rawText, confidence)
    };
  }

  if (request.mode === "counter") {
    return {
      ok: true,
      rawText,
      confidence,
      elapsedMs,
      blocksMined: parseBlocksMined(rawText)
    };
  }

  return {
    ok: true,
    rawText,
    confidence,
    elapsedMs,
    choppingSkill: parseChoppingFromText(rawText)
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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
