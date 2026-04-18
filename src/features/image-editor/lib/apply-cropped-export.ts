import type { Area } from "react-easy-crop";

import { renderCroppedRegionToCanvas } from "./crop-image";
import { encodeCanvasToOptimizedFile } from "./encode-image-blob";
import { placeImageOnCanvasAtBody, placeImageOnCanvasWithAsset } from "./insert-on-canvas";

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

/** Where to put the new image on the canvas. */
export type PlacementMode = "canvas" | "selection" | "replace";

/** Webflow Designer API `element.type` for Image elements. */
export const WEBFLOW_IMAGE_ELEMENT_TYPE = "Image" as const;

async function applyAssetFolder(asset: Asset, folder: AssetFolder): Promise<void> {
  await asset.setParent(folder);
}

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
        message: "Choose a component image field, then try again.",
      };
    }
    propId = chosen;
  }

  const match = imageProps.find((p) => p.propId === propId);
  if (!match) {
    return { kind: "error", message: "Could not resolve the component image field." };
  }

  await instance.setProps([{ propId, value: asset.id }]);
  return {
    kind: "success",
    message: `Updated “${match.display.label}”.`,
  };
}

export async function applyCroppedImageToWebflow(options: {
  imageSrc: string;
  completedCrop: Area;
  outputWidth: number;
  outputHeight: number;
  quality: number;
  fileBaseName: string;
  /** When the selection has multiple image props, the prop to set (from the panel). */
  componentImagePropId?: string | null;
  targetFolder: AssetFolder;
  placement: PlacementMode;
  /** Only for `placement === "replace"`: update the existing Assets file instead of uploading a new asset. */
  replaceLibraryAsset: boolean;
}): Promise<ExportResult> {
  const {
    imageSrc,
    completedCrop,
    outputWidth,
    outputHeight,
    quality,
    fileBaseName,
    componentImagePropId,
    targetFolder,
    placement,
    replaceLibraryAsset,
  } = options;

  try {
    const canvas = await renderCroppedRegionToCanvas(imageSrc, completedCrop, outputWidth, outputHeight);
    const { blob, fileName } = await encodeCanvasToOptimizedFile(canvas, quality, { baseName: fileBaseName });
    const file = new File([blob], fileName, { type: blob.type });
    const sel = await webflow.getSelectedElement();

    if (placement === "canvas") {
      const asset = await webflow.createAsset(file);
      await applyAssetFolder(asset, targetFolder);
      await placeImageOnCanvasAtBody(asset);
      return { kind: "success", message: "Image added to the page." };
    }

    if (placement === "replace") {
      if (sel?.type !== WEBFLOW_IMAGE_ELEMENT_TYPE) {
        return {
          kind: "info",
          message: "Select an Image on the canvas.",
        };
      }
      const img = sel as ImageElement;

      if (replaceLibraryAsset) {
        const existing = await img.getAsset();
        if (!existing) {
          const asset = await webflow.createAsset(file);
          await applyAssetFolder(asset, targetFolder);
          await img.setAsset(asset);
          await webflow.setSelectedElement(img);
          return { kind: "success", message: "Image applied." };
        }
        await existing.setFile(file);
        await applyAssetFolder(existing, targetFolder);
        await webflow.setSelectedElement(img);
        return { kind: "success", message: "Asset file updated." };
      }

      const asset = await webflow.createAsset(file);
      await applyAssetFolder(asset, targetFolder);
      await img.setAsset(asset);
      await webflow.setSelectedElement(img);
      return { kind: "success", message: "Image replaced." };
    }

    // placement === "selection"
    const asset = await webflow.createAsset(file);
    await applyAssetFolder(asset, targetFolder);

    if (sel?.type === "ComponentInstance") {
      const applied = await tryApplyComponentInstanceImageProp(sel as ComponentElement, asset, componentImagePropId);
      if (applied) {
        return applied;
      }
    }

    await placeImageOnCanvasWithAsset(asset, false);
    return { kind: "success", message: "Image placed." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not process the image.";
    return { kind: "error", message };
  }
}
