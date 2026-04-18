import { Crop, FileImage, SlidersHorizontal, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";

import {
  applyCroppedImageToWebflow,
  MAX_EDGE,
  parseOutputDimension,
} from "@/features/image-editor/lib/apply-cropped-export";
import { estimateEncodedOutputBytes, fetchUrlByteLength } from "@/features/image-editor/lib/estimate-encoded-size";
import { getExportGeometryKey } from "@/features/image-editor/lib/export-geometry-key";
import { loadImage } from "@/features/image-editor/lib/load-image";
import { sanitizeAssetBaseName } from "@/features/image-editor/lib/sanitize-asset-base-name";
import { ExportSizeEstimate } from "@/features/image-editor/ui/export-size-estimate";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Separator } from "@/shared/ui/separator";
import { Slider } from "@/shared/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

type AspectPreset = "free" | "1" | "16-9" | "4-3" | "3-2" | "9-16";

/** Aspect ratio templates vs. W×H-driven crop frame (same slot in the UI). */
type CropFrameMode = "aspect" | "custom";

/** Encode is expensive (AVIF/WASM); debounce so sliders do not queue hundreds of runs. */
const ESTIMATE_DEBOUNCE_MS = 400;

function aspectValue(preset: AspectPreset): number | undefined {
  switch (preset) {
    case "free":
      return undefined;
    case "1":
      return 1;
    case "16-9":
      return 16 / 9;
    case "4-3":
      return 4 / 3;
    case "3-2":
      return 3 / 2;
    case "9-16":
      return 9 / 16;
    default:
      return undefined;
  }
}

export function ImageEditor() {
  const baseId = useId();
  const replaceId = `${baseId}-replace`;
  const fileInputId = `${baseId}-file`;
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>("free");
  const [cropFrameMode, setCropFrameMode] = useState<CropFrameMode>("aspect");
  const [completedCrop, setCompletedCrop] = useState<Area | null>(null);
  const [outputWidth, setOutputWidth] = useState(1200);
  const [outputHeight, setOutputHeight] = useState(1200);
  const [widthStr, setWidthStr] = useState("1200");
  const [heightStr, setHeightStr] = useState("1200");
  const [fileBaseName, setFileBaseName] = useState("edited");
  const [quality, setQuality] = useState(0.75);
  const [busy, setBusy] = useState(false);
  const [replaceOnly, setReplaceOnly] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [originalBytes, setOriginalBytes] = useState<number | null>(null);
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [estimatePending, setEstimatePending] = useState(false);
  /** Bumps only on quality slider `onValueCommit` so encode runs after release, not on crop/dimensions. */
  const [estimateNonce, setEstimateNonce] = useState(0);
  const estimateGenRef = useRef(0);
  const lastInvalidatedGeometryKeyRef = useRef("");

  const effectiveOutputW = useMemo(() => parseOutputDimension(widthStr, outputWidth), [widthStr, outputWidth]);
  const effectiveOutputH = useMemo(() => parseOutputDimension(heightStr, outputHeight), [heightStr, outputHeight]);

  const cropAspect = useMemo(() => {
    if (cropFrameMode === "custom") {
      const h = effectiveOutputH;
      if (h <= 0) {
        return undefined;
      }
      return effectiveOutputW / h;
    }
    return aspectValue(aspectPreset);
  }, [cropFrameMode, effectiveOutputW, effectiveOutputH, aspectPreset]);

  useEffect(() => {
    void webflow.setExtensionSize({ width: 420, height: 820 });
  }, []);

  const revokePrevious = useCallback(
    (next: string | null) => {
      if (imageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
      setImageSrc(next);
    },
    [imageSrc]
  );

  useEffect(
    () => () => {
      if (imageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
    },
    [imageSrc]
  );

  useEffect(() => {
    if (!imageSrc) {
      return;
    }
    void loadImage(imageSrc)
      .then((img) => {
        const w = Math.min(MAX_EDGE, img.naturalWidth);
        const h = Math.min(MAX_EDGE, img.naturalHeight);
        setOutputWidth(w);
        setOutputHeight(h);
        setWidthStr(String(w));
        setHeightStr(String(h));
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCompletedCrop(null);
      })
      .catch(() => {
        if (imageSrc.startsWith("blob:")) {
          setImageSrc(null);
        }
      });
  }, [imageSrc]);

  const onFile = useCallback(
    (file: File | undefined) => {
      if (!file?.type.startsWith("image/")) {
        return;
      }
      setOriginalBytes(file.size);
      const stem = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
      setFileBaseName(sanitizeAssetBaseName(stem || "edited"));
      revokePrevious(URL.createObjectURL(file));
    },
    [revokePrevious]
  );

  const loadFromSelection = useCallback(async () => {
    const el = await webflow.getSelectedElement();
    if (el?.type !== "Image") {
      await webflow.notify({
        type: "Info",
        message: "Select an Image element on the canvas, then try again.",
      });
      return;
    }
    const asset = await el.getAsset();
    if (!asset) {
      await webflow.notify({
        type: "Warning",
        message: "The selected Image has no asset.",
      });
      return;
    }
    const url = await asset.getUrl();
    const size = await fetchUrlByteLength(url);
    setOriginalBytes(size);
    setFileBaseName("edited");
    revokePrevious(url);
  }, [revokePrevious]);

  useEffect(() => {
    const geometryKey = getExportGeometryKey(imageSrc, completedCrop, effectiveOutputW, effectiveOutputH);
    lastInvalidatedGeometryKeyRef.current = geometryKey;
    setEstimatedBytes(null);
    setEstimatePending(false);
    estimateGenRef.current += 1;
    setEstimateNonce(0);
  }, [imageSrc, completedCrop, effectiveOutputW, effectiveOutputH]);

  useEffect(() => {
    if (estimateNonce === 0 || !imageSrc || !completedCrop) {
      return;
    }
    const gen = ++estimateGenRef.current;
    setEstimatePending(true);
    const w = effectiveOutputW;
    const h = effectiveOutputH;
    const t = window.setTimeout(() => {
      void estimateEncodedOutputBytes({
        imageSrc,
        completedCrop,
        outputWidth: w,
        outputHeight: h,
        quality,
      })
        .then((bytes) => {
          if (estimateGenRef.current !== gen) {
            return;
          }
          setEstimatedBytes(bytes);
          setEstimatePending(false);
        })
        .catch(() => {
          if (estimateGenRef.current !== gen) {
            return;
          }
          setEstimatedBytes(null);
          setEstimatePending(false);
        });
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [estimateNonce, quality, imageSrc, completedCrop, effectiveOutputW, effectiveOutputH]);

  const onCropComplete = useCallback((_c: Area, px: Area) => {
    setCompletedCrop(px);
  }, []);

  const applyToCanvas = useCallback(async () => {
    if (!imageSrc || !completedCrop) {
      await webflow.notify({
        type: "Warning",
        message: "Load an image and adjust the crop first.",
      });
      return;
    }
    setBusy(true);
    try {
      const w = effectiveOutputW;
      const h = effectiveOutputH;
      setOutputWidth(w);
      setOutputHeight(h);
      setWidthStr(String(w));
      setHeightStr(String(h));
      const safeName = sanitizeAssetBaseName(fileBaseName);
      setFileBaseName(safeName);
      const result = await applyCroppedImageToWebflow({
        imageSrc,
        completedCrop,
        outputWidth: w,
        outputHeight: h,
        quality,
        replaceOnly,
        fileBaseName: safeName,
      });
      if (result.kind === "success") {
        await webflow.notify({ type: "Success", message: result.message });
        return;
      }
      if (result.kind === "info") {
        await webflow.notify({ type: "Info", message: result.message });
        return;
      }
      await webflow.notify({ type: "Error", message: result.message });
    } finally {
      setBusy(false);
    }
  }, [imageSrc, completedCrop, effectiveOutputW, effectiveOutputH, quality, replaceOnly, fileBaseName]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragState = useCallback((e: React.DragEvent, active: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(active);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      handleDragState(e, false);
      const file = e.dataTransfer.files?.[0];
      onFile(file);
    },
    [handleDragState, onFile]
  );

  return (
    <ScrollArea className="h-full min-h-0 flex-1">
      <div className="flex flex-col gap-0 pb-1 pr-3">
        <section className="flex flex-col gap-2 py-1">
          <h1 className="text-base font-semibold leading-none">Image crop &amp; AVIF</h1>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Pan and zoom, use aspect presets or custom output size, tune quality, then place or replace on the canvas.
          </p>
        </section>

        <Separator className="my-4" />

        <section className="flex flex-col gap-3">
          <input
            id={fileInputId}
            aria-label="Choose image file"
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <label
            className={
              dragActive
                ? "block cursor-pointer rounded-xl border-2 border-dashed border-primary bg-accent/40 p-4 transition-colors"
                : "block cursor-pointer rounded-xl border-2 border-dashed border-border bg-muted/30 p-4 transition-colors"
            }
            htmlFor={fileInputId}
            onDragEnter={(e) => handleDragState(e, true)}
            onDragLeave={(e) => handleDragState(e, false)}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <span className="flex flex-col items-center gap-2 text-center">
              <Upload aria-hidden className="size-8 text-muted-foreground" />
              <span className="text-muted-foreground text-xs">Drop an image here, or tap to choose a file.</span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-transparent bg-primary px-2.5 py-1 text-[0.8rem] font-medium text-primary-foreground">
                <FileImage aria-hidden className="size-3.5" />
                Browse files
              </span>
            </span>
          </label>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void loadFromSelection()}>
            Use selected Image
          </Button>
        </section>

        {imageSrc ? (
          <>
            <Separator className="my-4" />
            <Tabs defaultValue="crop">
              <TabsList className="grid w-full grid-cols-2" variant="default">
                <TabsTrigger value="crop">
                  <Crop aria-hidden className="size-4" />
                  Crop
                </TabsTrigger>
                <TabsTrigger value="export">
                  <SlidersHorizontal aria-hidden className="size-4" />
                  Export
                </TabsTrigger>
              </TabsList>
              <TabsContent className="mt-4 flex flex-col gap-0" value="crop">
                <section className="flex flex-col gap-3">
                  <div className="relative h-52 w-full overflow-hidden rounded-lg border border-border bg-muted">
                    <Cropper
                      aspect={cropAspect}
                      image={imageSrc}
                      crop={crop}
                      zoom={zoom}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={onCropComplete}
                      objectFit="contain"
                    />
                  </div>
                </section>
                <Separator className="my-4" />
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-muted-foreground text-xs" htmlFor={`${baseId}-frame-mode`}>
                      Crop frame
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground cursor-help text-xs">How it works</span>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        Aspect presets lock the crop to common ratios. Custom size sets output width and height; the
                        crop matches that ratio.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <ToggleGroup
                    id={`${baseId}-frame-mode`}
                    className="grid w-full grid-cols-2 gap-1"
                    type="single"
                    value={cropFrameMode}
                    onValueChange={(v) => {
                      if (v) {
                        setCropFrameMode(v as CropFrameMode);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    spacing={0}
                  >
                    <ToggleGroupItem value="aspect">Aspect presets</ToggleGroupItem>
                    <ToggleGroupItem value="custom">Custom size</ToggleGroupItem>
                  </ToggleGroup>
                  {cropFrameMode === "aspect" ? (
                    <ToggleGroup
                      id={`${baseId}-aspect`}
                      className="grid w-full grid-cols-3 gap-1"
                      type="single"
                      value={aspectPreset}
                      onValueChange={(v) => {
                        if (v) {
                          setAspectPreset(v as AspectPreset);
                        }
                      }}
                      variant="outline"
                      size="sm"
                      spacing={0}
                    >
                      <ToggleGroupItem value="free">Free</ToggleGroupItem>
                      <ToggleGroupItem value="1">1:1</ToggleGroupItem>
                      <ToggleGroupItem value="16-9">16:9</ToggleGroupItem>
                      <ToggleGroupItem value="4-3">4:3</ToggleGroupItem>
                      <ToggleGroupItem value="3-2">3:2</ToggleGroupItem>
                      <ToggleGroupItem value="9-16">9:16</ToggleGroupItem>
                    </ToggleGroup>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label htmlFor={`${baseId}-ow`}>Width (px)</Label>
                          </TooltipTrigger>
                          <TooltipContent>Output width before encoding (1–8192 px).</TooltipContent>
                        </Tooltip>
                        <Input
                          id={`${baseId}-ow`}
                          aria-label="Output width in pixels"
                          inputMode="numeric"
                          type="text"
                          value={widthStr}
                          onChange={(e) => setWidthStr(e.target.value)}
                          onBlur={() => {
                            const w = parseOutputDimension(widthStr, outputWidth);
                            setOutputWidth(w);
                            setWidthStr(String(w));
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label htmlFor={`${baseId}-oh`}>Height (px)</Label>
                          </TooltipTrigger>
                          <TooltipContent>Output height before encoding (1–8192 px).</TooltipContent>
                        </Tooltip>
                        <Input
                          id={`${baseId}-oh`}
                          aria-label="Output height in pixels"
                          inputMode="numeric"
                          type="text"
                          value={heightStr}
                          onChange={(e) => setHeightStr(e.target.value)}
                          onBlur={() => {
                            const h = parseOutputDimension(heightStr, outputHeight);
                            setOutputHeight(h);
                            setHeightStr(String(h));
                          }}
                        />
                      </div>
                    </div>
                  )}
                </section>
                <Separator className="my-4" />
                <section className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs" htmlFor={`${baseId}-zoom`}>
                    Zoom
                  </Label>
                  <Slider
                    id={`${baseId}-zoom`}
                    min={1}
                    max={4}
                    step={0.01}
                    value={[zoom]}
                    onValueChange={(v) => setZoom(v[0] ?? 1)}
                  />
                </section>
              </TabsContent>
              <TabsContent className="mt-4 flex flex-col gap-0" value="export">
                <section className="flex flex-col gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label htmlFor={`${baseId}-fn`}>File name</Label>
                    </TooltipTrigger>
                    <TooltipContent>
                      Base name for the uploaded asset; .avif or .webp is added from the encoder.
                    </TooltipContent>
                  </Tooltip>
                  <Input
                    id={`${baseId}-fn`}
                    aria-label="Exported file base name"
                    autoComplete="off"
                    value={fileBaseName}
                    onChange={(e) => setFileBaseName(e.target.value)}
                    onBlur={() => setFileBaseName(sanitizeAssetBaseName(fileBaseName))}
                  />
                </section>
                <Separator className="my-4" />
                <section className="flex flex-col gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="text-muted-foreground text-xs" htmlFor={`${baseId}-quality`}>
                        Encode quality
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent>
                      Higher values preserve more detail and increase file size. Release the slider to refresh the size
                      estimate.
                    </TooltipContent>
                  </Tooltip>
                  <Slider
                    id={`${baseId}-quality`}
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={[quality]}
                    onValueChange={(v) => setQuality(v[0] ?? 0.75)}
                    onValueCommit={() => setEstimateNonce((n) => n + 1)}
                  />
                  <ExportSizeEstimate
                    completedCrop={completedCrop}
                    estimatePending={estimatePending}
                    estimatedBytes={estimatedBytes}
                    originalBytes={originalBytes}
                    showQualityCommitHint={completedCrop !== null && estimateNonce === 0}
                  />
                </section>
                <Separator className="my-4" />
                <section className="flex items-start gap-2">
                  <Checkbox id={replaceId} checked={replaceOnly} onCheckedChange={(v) => setReplaceOnly(v === true)} />
                  <div className="grid gap-1">
                    <Label className="font-normal" htmlFor={replaceId}>
                      Replace selected Image only
                    </Label>
                    <p className="text-muted-foreground text-xs leading-snug">
                      Skips placing a new image when an Image is selected.
                    </p>
                  </div>
                </section>
                <Separator className="my-4" />
                <section>
                  <Button type="button" className="w-full" disabled={busy} onClick={() => void applyToCanvas()}>
                    {busy ? "Working…" : "Compress & place on canvas"}
                  </Button>
                </section>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <>
            <Separator className="my-4" />
            <p className="text-muted-foreground px-1 text-xs">
              Upload a file, drop one onto the area above, or load the asset from a selected Image element.
            </p>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
