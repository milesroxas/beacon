/** Safe base name for Webflow assets (extension added separately). */
export function sanitizeAssetBaseName(raw: string): string {
  const trimmed = raw.trim();
  const withoutExt = trimmed.replace(/\.(avif|webp|png|jpe?g|gif|svg)$/i, "");
  const safe = withoutExt
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 100);
  return safe.length > 0 ? safe : "edited";
}
