import { encode as encodeAvif } from "@jsquash/avif";

import { sanitizeAssetBaseName } from "@/features/image-editor/lib/sanitize-asset-base-name";
import { waitForNextPaint } from "@/shared/lib/wait-for-next-paint";

async function mimeEncodeSupported(type: string): Promise<boolean> {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob?.type === type), type);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Encoding produced no blob"));
        }
      },
      type,
      quality
    );
  });
}

export type EncodedImage = {
  blob: Blob;
  fileName: string;
  mimeType: string;
};

export async function encodeCanvasToOptimizedFile(
  canvas: HTMLCanvasElement,
  quality: number,
  options?: { baseName?: string }
): Promise<EncodedImage> {
  const base = sanitizeAssetBaseName(options?.baseName ?? "edited");
  const q = Math.min(1, Math.max(0.05, quality));
  await waitForNextPaint();
  const ctx = canvas.getContext("2d");
  if (ctx) {
    try {
      const raw = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Copy so underlying buffer is tight RGBA @ byteOffset 0 — @jsquash/avif uses `new Uint8Array(data.data.buffer)`.
      const imageData = new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height);
      await waitForNextPaint();
      const buffer = await encodeAvif(imageData, { quality: Math.round(q * 100) });
      const blob = new Blob([buffer], { type: "image/avif" });
      return { blob, fileName: `${base}.avif`, mimeType: "image/avif" };
    } catch {
      /* fall through */
    }
  }
  if (await mimeEncodeSupported("image/avif")) {
    try {
      const blob = await canvasToBlob(canvas, "image/avif", q);
      if (blob.size > 0 && (blob.type === "image/avif" || blob.type === "")) {
        return { blob, fileName: `${base}.avif`, mimeType: "image/avif" };
      }
    } catch {
      /* fall through */
    }
  }
  const blob = await canvasToBlob(canvas, "image/webp", q);
  return {
    blob,
    fileName: `${base}.webp`,
    mimeType: blob.type || "image/webp",
  };
}
