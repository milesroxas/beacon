export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Human-readable comparison vs. original file (originalBytes > 0). */
export function formatSizeDeltaPercent(originalBytes: number, outputBytes: number): string {
  if (originalBytes <= 0 || !Number.isFinite(outputBytes)) {
    return "";
  }
  const ratio = outputBytes / originalBytes;
  if (Math.abs(ratio - 1) < 0.0005) {
    return "About the same size as the original file.";
  }
  if (ratio < 1) {
    const pct = (1 - ratio) * 100;
    const n = pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
    return `Estimated output is ${n}% smaller than the original file.`;
  }
  const pct = (ratio - 1) * 100;
  const n = pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
  return `Estimated output is ${n}% larger than the original file.`;
}
