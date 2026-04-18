import type { Area } from "react-easy-crop";

/** Stable string for when export geometry (source, crop, output size) changes. */
export function getExportGeometryKey(
  imageSrc: string | null,
  completedCrop: Area | null,
  outputWidth: number,
  outputHeight: number
): string {
  const cropPart = completedCrop
    ? `${completedCrop.x},${completedCrop.y},${completedCrop.width},${completedCrop.height}`
    : "";
  return `${imageSrc ?? ""}|${cropPart}|${outputWidth}|${outputHeight}`;
}
