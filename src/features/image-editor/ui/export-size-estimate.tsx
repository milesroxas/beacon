import { Loader2 } from "lucide-react";
import type { Area } from "react-easy-crop";

import { formatFileSize, formatSizeDeltaPercent } from "@/features/image-editor/lib/format-file-size";
import { Separator } from "@/shared/ui/separator";

type ExportSizeEstimateProps = {
  originalBytes: number | null;
  estimatedBytes: number | null;
  estimatePending: boolean;
  completedCrop: Area | null;
  /** Crop is ready but the user has not released the quality slider since the last geometry change. */
  showQualityCommitHint?: boolean;
};

export function ExportSizeEstimate({
  originalBytes,
  estimatedBytes,
  estimatePending,
  completedCrop,
  showQualityCommitHint = false,
}: ExportSizeEstimateProps) {
  const outputLabel = estimatedBytes !== null ? formatFileSize(estimatedBytes) : !completedCrop ? "Crop first" : "—";

  const showDelta = originalBytes !== null && estimatedBytes !== null && !estimatePending && completedCrop;

  const showUnknownOriginalNote =
    originalBytes === null && estimatedBytes !== null && !estimatePending && completedCrop;

  return (
    <div aria-busy={estimatePending} aria-live="polite" className="flex flex-col gap-2 text-xs leading-relaxed">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Original</span>
        <span className="tabular-nums">{originalBytes !== null ? formatFileSize(originalBytes) : "Unknown"}</span>
      </div>
      <Separator />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Est. output</span>
        {estimatePending ? (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 tabular-nums" role="status">
            <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin will-change-transform" />
            Encoding preview…
          </span>
        ) : (
          <span className="tabular-nums">{outputLabel}</span>
        )}
      </div>
      {showQualityCommitHint && !estimatePending && completedCrop && (
        <>
          <Separator />
          <p className="text-muted-foreground">Release the quality slider to estimate output size.</p>
        </>
      )}
      {showDelta && (
        <>
          <Separator />
          <p className="text-muted-foreground">{formatSizeDeltaPercent(originalBytes, estimatedBytes)}</p>
        </>
      )}
      {showUnknownOriginalNote && (
        <>
          <Separator />
          <p className="text-muted-foreground">Original size unavailable; estimate uses your export settings only.</p>
        </>
      )}
    </div>
  );
}
