import { type PlacementMode, WEBFLOW_IMAGE_ELEMENT_TYPE } from "@/features/image-editor/lib/apply-cropped-export";

export type ImageEditorPlacementBlocker =
  | "missing-crop"
  | "replace-wrong-type"
  | "selection-empty"
  | "selection-props-loading"
  | "selection-pick-field";

export type ImageEditorPlacementReadiness = { ok: true } | { ok: false; blocker: ImageEditorPlacementBlocker };

export type ImageEditorPlacementContext = {
  placement: PlacementMode;
  hasCompletedCrop: boolean;
  selectedElementType: string | null;
  componentImagePropsResolving: boolean;
  componentImagePropCount: number;
  selectedComponentImagePropId: string | null;
};

/**
 * Preconditions for the editor primary action (before encode/upload).
 * Stricter than `applyCroppedImageToWebflow` for selection mode (requires a canvas selection).
 */
export function getImageEditorPlacementReadiness(ctx: ImageEditorPlacementContext): ImageEditorPlacementReadiness {
  if (!ctx.hasCompletedCrop) {
    return { ok: false, blocker: "missing-crop" };
  }
  if (ctx.placement === "canvas") {
    return { ok: true };
  }
  if (ctx.placement === "replace") {
    if (ctx.selectedElementType !== WEBFLOW_IMAGE_ELEMENT_TYPE) {
      return { ok: false, blocker: "replace-wrong-type" };
    }
    return { ok: true };
  }
  if (!ctx.selectedElementType) {
    return { ok: false, blocker: "selection-empty" };
  }
  if (ctx.componentImagePropsResolving) {
    return { ok: false, blocker: "selection-props-loading" };
  }
  if (ctx.componentImagePropCount > 1 && !ctx.selectedComponentImagePropId) {
    return { ok: false, blocker: "selection-pick-field" };
  }
  return { ok: true };
}
