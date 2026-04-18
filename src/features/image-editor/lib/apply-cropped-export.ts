import type { Area } from "react-easy-crop";

import { renderCroppedRegionToCanvas } from "./crop-image";
import { encodeCanvasToOptimizedFile } from "./encode-image-blob";
import { placeImageOnCanvasWithAsset } from "./insert-on-canvas";

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

/** Returns a finished result if an image prop was applied; `null` if the instance has no image props. */
async function tryApplyComponentInstanceImageProp(
  instance: ComponentElement,
  asset: Asset,
  componentImagePropId: string | null | undefined
): Promise<ExportResult | null> {
  const imageProps = await instance.searchProps({ valueType: "imageAsset" });
  if (imageProps.length === 0) {
    return null;
  }

  let propId: string | null = null;
  if (imageProps.length === 1) {
    propId = imageProps[0].propId;
  } else {
    const chosen = componentImagePropId ?? null;
    if (!chosen || !imageProps.some((p) => p.propId === chosen)) {
      return {
        kind: "info",
        message: "Select which component image prop to use, then try again.",
      };
    }
    propId = chosen;
  }

  const match = imageProps.find((p) => p.propId === propId);
  if (!match) {
    return { kind: "error", message: "Could not resolve the component image prop." };
  }

  await instance.setProps([{ propId, value: asset.id }]);
  return {
    kind: "success",
    message: `Image set on “${match.display.label}”.`,
  };
}

export async function applyCroppedImageToWebflow(options: {
  imageSrc: string;
  completedCrop: Area;
  outputWidth: number;
  outputHeight: number;
  quality: number;
  replaceOnly: boolean;
  fileBaseName: string;
  /** When the selection has multiple image props, the prop to set (from the panel). */
  componentImagePropId?: string | null;
}): Promise<ExportResult> {
  const {
    imageSrc,
    completedCrop,
    outputWidth,
    outputHeight,
    quality,
    replaceOnly,
    fileBaseName,
    componentImagePropId,
  } = options;

  try {
    const canvas = await renderCroppedRegionToCanvas(imageSrc, completedCrop, outputWidth, outputHeight);
    const { blob, fileName } = await encodeCanvasToOptimizedFile(canvas, quality, { baseName: fileBaseName });
    const file = new File([blob], fileName, { type: blob.type });
    const asset = await webflow.createAsset(file);
    const sel = await webflow.getSelectedElement();

    if (sel?.type === "ComponentInstance") {
      const applied = await tryApplyComponentInstanceImageProp(sel as ComponentElement, asset, componentImagePropId);
      if (applied) {
        return applied;
      }
    }

    if (replaceOnly) {
      if (sel?.type !== "Image") {
        return {
          kind: "info",
          message: "Turn off “Replace selected image” or select an Image element.",
        };
      }
    }

    await placeImageOnCanvasWithAsset(asset, replaceOnly);
    return {
      kind: "success",
      message: replaceOnly ? "Image asset updated." : "Image placed on the canvas.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not process the image.";
    return { kind: "error", message };
  }
}
