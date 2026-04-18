import type { Area } from "react-easy-crop";

import { clampEdge } from "./apply-cropped-export";
import { renderCroppedRegionToCanvas } from "./crop-image";
import { encodeCanvasToOptimizedFile } from "./encode-image-blob";

export async function estimateEncodedOutputBytes(options: {
  imageSrc: string;
  completedCrop: Area;
  outputWidth: number;
  outputHeight: number;
  quality: number;
}): Promise<number> {
  const w = clampEdge(options.outputWidth);
  const h = clampEdge(options.outputHeight);
  const canvas = await renderCroppedRegionToCanvas(options.imageSrc, options.completedCrop, w, h);
  const { blob } = await encodeCanvasToOptimizedFile(canvas, options.quality);
  return blob.size;
}

export async function fetchUrlByteLength(url: string): Promise<number | null> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) {
      const raw = head.headers.get("Content-Length");
      if (raw) {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 0) {
          return n;
        }
      }
    }
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const blob = await res.blob();
    return blob.size;
  } catch {
    return null;
  }
}
