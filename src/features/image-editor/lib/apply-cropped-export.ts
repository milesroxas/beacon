import type { Area } from "react-easy-crop";

import { renderCroppedRegionToCanvas } from "./crop-image";
import { encodeCanvasToOptimizedFile } from "./encode-image-blob";
import { placeImageOnCanvas } from "./insert-on-canvas";

export const MAX_EDGE = 8192;
export const MIN_EDGE = 1;

export function clampEdge(n: number): number {
  if (Number.isNaN(n)) {
    return MIN_EDGE;
  }
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, Math.round(n)));
}

/** Resolves width/height from the export inputs; empty or invalid uses fallback. */
export function parseOutputDimension(input: string, fallback: number): number {
  const n = Number(input);
  if (input.trim() === "" || Number.isNaN(n)) {
    return clampEdge(fallback);
  }
  return clampEdge(n);
}

export type ExportResult =
  | { kind: "success"; message: string }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

export async function applyCroppedImageToWebflow(options: {
  imageSrc: string;
  completedCrop: Area;
  outputWidth: number;
  outputHeight: number;
  quality: number;
  replaceOnly: boolean;
  fileBaseName: string;
}): Promise<ExportResult> {
  const { imageSrc, completedCrop, outputWidth, outputHeight, quality, replaceOnly, fileBaseName } = options;

  try {
    const canvas = await renderCroppedRegionToCanvas(imageSrc, completedCrop, outputWidth, outputHeight);
    const { blob, fileName } = await encodeCanvasToOptimizedFile(canvas, quality, { baseName: fileBaseName });
    const file = new File([blob], fileName, { type: blob.type });

    if (replaceOnly) {
      const sel = await webflow.getSelectedElement();
      if (sel?.type !== "Image") {
        return {
          kind: "info",
          message: "Turn off “Replace selected image” or select an Image element.",
        };
      }
    }

    await placeImageOnCanvas(file, replaceOnly);
    return {
      kind: "success",
      message: replaceOnly ? "Image asset updated." : "Image placed on the canvas.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not process the image.";
    return { kind: "error", message };
  }
}
