import { FileImage, Upload } from "lucide-react";
import type { DragEvent, RefObject, TransitionEvent } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Area } from "react-easy-crop";

import {
  applyCroppedImageToWebflow,
  MAX_EDGE,
  type PlacementMode,
  parseOutputDimension,
} from "@/features/image-editor/lib/apply-cropped-export";
import { estimateEncodedOutputBytes } from "@/features/image-editor/lib/estimate-encoded-size";
import { getExportGeometryKey } from "@/features/image-editor/lib/export-geometry-key";
import { loadImage } from "@/features/image-editor/lib/load-image";
import { sanitizeAssetBaseName } from "@/features/image-editor/lib/sanitize-asset-base-name";
import {
  type AspectPreset,
  type AssetFolderRow,
  type ComponentImagePropOption,
  type CropFrameMode,
  ImageEditorCropExportPanel,
} from "@/features/image-editor/ui/image-editor-crop-export-panel";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { ScrollArea } from "@/shared/ui/scroll-area";

/** Designer typings omit `getParent` on `AssetFolder`; runtime supports it (see Webflow docs). */
async function getAssetFolderParentFolder(handle: AssetFolder): Promise<AssetFolder | null> {
  const h = handle as AssetFolder & { getParent?: () => Promise<AssetFolder | null> };
  try {
    return (await h.getParent?.()) ?? null;
  } catch {
    return null;
  }
}

function resolveSelectedAssetFolderHandle(
  selectedAssetFolderId: string | null,
  assetFolders: AssetFolderRow[]
): AssetFolder | undefined {
  if (selectedAssetFolderId === null) {
    return undefined;
  }
  return assetFolders.find((f) => f.id === selectedAssetFolderId)?.handle;
}

/** Encode is expensive (AVIF/WASM); debounce so sliders do not queue hundreds of runs. */
const ESTIMATE_DEBOUNCE_MS = 400;

const OUTGOING_FADE_CLASS = "transition-opacity duration-[380ms] ease-out will-change-[opacity] transform-gpu";

const INCOMING_STAGGER_BASE_CLASS =
  "transition-[opacity,transform] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] transform-gpu duration-300";

function IncomingDissolvePreview(props: {
  imageUrl: string;
  fileBaseName: string;
  entered: boolean;
  onEntranceComplete?: () => void;
}) {
  const { imageUrl, fileBaseName, entered, onEntranceComplete } = props;
  return (
    <div className="flex flex-col gap-3">
      <p
        className={cn(
          INCOMING_STAGGER_BASE_CLASS,
          "text-muted-foreground min-w-0 truncate text-xs leading-snug",
          entered ? "translate-y-0 opacity-100 [transition-delay:0ms]" : "translate-y-2 opacity-0"
        )}
        title={fileBaseName}
      >
        <span className="text-foreground font-medium">Source: </span>
        {fileBaseName}
      </p>
      <div
        className={cn(
          INCOMING_STAGGER_BASE_CLASS,
          "aspect-video overflow-hidden rounded-xl bg-muted/50 ring-1 ring-foreground/10",
          entered
            ? "translate-y-0 opacity-100 [transition-delay:90ms]"
            : "translate-y-3 opacity-0 [transition-delay:0ms]"
        )}
        onTransitionEnd={(e) => {
          if (e.target !== e.currentTarget || e.propertyName !== "opacity") {
            return;
          }
          onEntranceComplete?.();
        }}
      >
        <img alt="" className="size-full object-contain" decoding="async" src={imageUrl} />
      </div>
    </div>
  );
}

function DropzoneCard(props: {
  className: string;
  fileInputId: string;
  onDragEnter: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const { className, fileInputId, onDragEnter, onDragLeave, onDragOver, onDrop } = props;
  return (
    <label
      className={className}
      htmlFor={fileInputId}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="flex flex-col items-center gap-2 text-center">
        <Upload aria-hidden className="size-8 text-muted-foreground" />
        <span className="text-muted-foreground text-xs">Drop an image, or browse.</span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-transparent bg-primary px-2.5 py-1 text-[0.8rem] font-medium text-primary-foreground">
          <FileImage aria-hidden className="size-3.5" />
          Browse files
        </span>
      </span>
    </label>
  );
}

function EmptyImageSourceSection(props: {
  fileInputId: string;
  dropZoneLabelClass: string;
  handleDrag: (e: DragEvent) => void;
  handleDragState: (e: DragEvent, active: boolean) => void;
  handleDrop: (e: DragEvent) => void;
}) {
  const { fileInputId, dropZoneLabelClass, handleDrag, handleDragState, handleDrop } = props;
  return (
    <DropzoneCard
      className={dropZoneLabelClass}
      fileInputId={fileInputId}
      onDragEnter={(e) => handleDragState(e, true)}
      onDragLeave={(e) => handleDragState(e, false)}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    />
  );
}

function LoadedImageSourceSection(props: {
  fileBaseName: string;
  busy: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
}) {
  const { fileBaseName, busy, fileInputRef } = props;
  return (
    <Card size="sm">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-sm font-medium">Source image</CardTitle>
        <CardDescription className="min-w-0 truncate text-xs leading-snug" title={fileBaseName}>
          {fileBaseName}
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden className="size-3.5" />
            Change image
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

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
  const fileInputId = `${baseId}-file`;
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [assetFolders, setAssetFolders] = useState<AssetFolderRow[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderActionBusy, setFolderActionBusy] = useState(false);
  const [selectedAssetFolderId, setSelectedAssetFolderId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PlacementMode>("selection");
  const [replaceLibraryAsset, setReplaceLibraryAsset] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [originalBytes, setOriginalBytes] = useState<number | null>(null);
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [estimatePending, setEstimatePending] = useState(false);
  /** Bumps only on quality slider `onValueCommit` so encode runs after release, not on crop/dimensions. */
  const [estimateNonce, setEstimateNonce] = useState(0);
  const estimateGenRef = useRef(0);
  const lastInvalidatedGeometryKeyRef = useRef("");
  const [componentImageProps, setComponentImageProps] = useState<ComponentImagePropOption[]>([]);
  const [selectedComponentImagePropId, setSelectedComponentImagePropId] = useState<string | null>(null);
  const [selectedElementType, setSelectedElementType] = useState<string | null>(null);
  const [componentImagePropsResolving, setComponentImagePropsResolving] = useState(false);
  const componentPropsResolveGenRef = useRef(0);
  const [dissolve, setDissolve] = useState<
    { phase: "idle" } | { phase: "dissolving"; incomingUrl: string; incomingFile: File }
  >({ phase: "idle" });
  const [beginOutgoingFade, setBeginOutgoingFade] = useState(false);
  const [showIncomingPreview, setShowIncomingPreview] = useState(false);
  const [incomingEnter, setIncomingEnter] = useState(false);
  const dissolveRef = useRef(dissolve);
  dissolveRef.current = dissolve;
  const dissolveSettledRef = useRef(false);

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
    void webflow.setExtensionSize({ width: 440, height: 880 });
  }, []);

  const refreshAssetFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      const handles = await webflow.getAllAssetFolders();
      const partial: {
        handle: AssetFolder;
        id: string;
        name: string;
        parentId: string | null;
      }[] = [];

      for (const handle of handles) {
        const name = (await handle.getName()).trim() || "Folder";
        const parent = await getAssetFolderParentFolder(handle);
        const parentId = parent?.id ?? null;
        partial.push({ handle, id: handle.id, name, parentId });
      }

      const byId = new Map(partial.map((row) => [row.id, row]));

      const pathLabelFor = (id: string, seen = new Set<string>()): string => {
        if (seen.has(id)) {
          return byId.get(id)?.name ?? "";
        }
        seen.add(id);
        const row = byId.get(id);
        if (!row) {
          return "";
        }
        if (!row.parentId) {
          return row.name;
        }
        const parentPath = pathLabelFor(row.parentId, seen);
        return parentPath ? `${parentPath} / ${row.name}` : row.name;
      };

      const rows: AssetFolderRow[] = partial.map((p) => ({
        ...p,
        pathLabel: pathLabelFor(p.id),
      }));
      rows.sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
      setAssetFolders(rows);
    } catch {
      setAssetFolders([]);
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  const createAssetFolderNamed = useCallback(
    async (name: string, parentFolderId: string | null): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) {
        return false;
      }
      setFolderActionBusy(true);
      try {
        const folder =
          parentFolderId !== null
            ? await webflow.createAssetFolder(trimmed, parentFolderId)
            : await webflow.createAssetFolder(trimmed);
        await refreshAssetFolders();
        setSelectedAssetFolderId(folder.id);
        return true;
      } catch {
        await webflow.notify({ type: "Error", message: "Could not create folder." });
        return false;
      } finally {
        setFolderActionBusy(false);
      }
    },
    [refreshAssetFolders]
  );

  useEffect(() => {
    if (!imageSrc) {
      return;
    }
    void refreshAssetFolders();
  }, [imageSrc, refreshAssetFolders]);

  useEffect(() => {
    if (selectedAssetFolderId === null) {
      return;
    }
    if (!assetFolders.some((f) => f.id === selectedAssetFolderId)) {
      setSelectedAssetFolderId(null);
    }
  }, [assetFolders, selectedAssetFolderId]);

  const refreshComponentImageProps = useCallback(async (el: AnyElement | null) => {
    const gen = ++componentPropsResolveGenRef.current;
    setSelectedElementType(el?.type ?? null);

    if (el?.type !== "ComponentInstance") {
      setComponentImagePropsResolving(false);
      setComponentImageProps([]);
      setSelectedComponentImagePropId(null);
      return;
    }

    setComponentImagePropsResolving(true);
    try {
      const instance = el as ComponentElement;
      const props = await instance.searchProps({ valueType: "imageAsset" });
      if (gen !== componentPropsResolveGenRef.current) {
        return;
      }
      const opts: ComponentImagePropOption[] = props.map((p) => ({
        propId: p.propId,
        label: p.display.label,
      }));
      setComponentImageProps(opts);
      setSelectedComponentImagePropId((prev) => {
        if (opts.length === 0) {
          return null;
        }
        if (opts.length === 1) {
          return opts[0].propId;
        }
        if (prev && opts.some((o) => o.propId === prev)) {
          return prev;
        }
        return opts[0].propId;
      });
    } catch {
      if (gen !== componentPropsResolveGenRef.current) {
        return;
      }
      setComponentImageProps([]);
      setSelectedComponentImagePropId(null);
    } finally {
      if (gen === componentPropsResolveGenRef.current) {
        setComponentImagePropsResolving(false);
      }
    }
  }, []);

  useEffect(() => {
    void webflow.getSelectedElement().then((el) => void refreshComponentImageProps(el));
    const unsub = webflow.subscribe("selectedelement", (el) => {
      void refreshComponentImageProps(el);
    });
    return unsub;
  }, [refreshComponentImageProps]);

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

  const queueFile = useCallback((file: File | undefined) => {
    if (!file?.type.startsWith("image/")) {
      return;
    }
    if (dissolveRef.current.phase === "dissolving") {
      return;
    }
    const incomingUrl = URL.createObjectURL(file);
    setDissolve({ phase: "dissolving", incomingUrl, incomingFile: file });
    dissolveSettledRef.current = false;
  }, []);

  const finishDissolve = useCallback(() => {
    const d = dissolveRef.current;
    if (d.phase !== "dissolving") {
      return;
    }
    if (dissolveSettledRef.current) {
      return;
    }
    dissolveSettledRef.current = true;
    const { incomingUrl, incomingFile } = d;
    setOriginalBytes(incomingFile.size);
    const stem = incomingFile.name.includes(".")
      ? incomingFile.name.slice(0, incomingFile.name.lastIndexOf("."))
      : incomingFile.name;
    setFileBaseName(sanitizeAssetBaseName(stem || "edited"));
    setImageSrc((prev) => {
      if (prev?.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return incomingUrl;
    });
    setDissolve({ phase: "idle" });
    setBeginOutgoingFade(false);
    setShowIncomingPreview(false);
    setIncomingEnter(false);
  }, []);

  const handleOutgoingFadeComplete = useCallback(
    (e: TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.propertyName !== "opacity" || !beginOutgoingFade) {
        return;
      }
      setShowIncomingPreview(true);
    },
    [beginOutgoingFade]
  );

  useLayoutEffect(() => {
    if (dissolve.phase !== "dissolving") {
      return;
    }
    setBeginOutgoingFade(false);
    setShowIncomingPreview(false);
    setIncomingEnter(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setBeginOutgoingFade(true);
      });
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [dissolve]);

  useLayoutEffect(() => {
    if (!showIncomingPreview) {
      return;
    }
    setIncomingEnter(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIncomingEnter(true);
      });
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [showIncomingPreview]);

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
    const targetFolder = resolveSelectedAssetFolderHandle(selectedAssetFolderId, assetFolders);
    if (!targetFolder) {
      await webflow.notify({
        type: "Warning",
        message: "Choose an Assets folder first.",
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
        fileBaseName: safeName,
        componentImagePropId: componentImageProps.length > 1 ? selectedComponentImagePropId : null,
        targetFolder,
        placement,
        replaceLibraryAsset: placement === "replace" ? replaceLibraryAsset : false,
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
  }, [
    imageSrc,
    completedCrop,
    effectiveOutputW,
    effectiveOutputH,
    quality,
    fileBaseName,
    componentImageProps.length,
    selectedComponentImagePropId,
    selectedAssetFolderId,
    assetFolders,
    placement,
    replaceLibraryAsset,
  ]);

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragState = useCallback((e: DragEvent, active: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(active);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      handleDragState(e, false);
      const file = e.dataTransfer.files?.[0];
      queueFile(file);
    },
    [handleDragState, queueFile]
  );

  const dropZoneLabelClass = cn(
    "flex aspect-video w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed p-4 transition-colors",
    dragActive ? "border-primary bg-accent/40" : "border-border bg-muted/30"
  );

  const loadedEditor =
    imageSrc != null ? (
      <>
        <section className="flex flex-col gap-3">
          <LoadedImageSourceSection busy={busy} fileBaseName={fileBaseName} fileInputRef={fileInputRef} />
        </section>
        <ImageEditorCropExportPanel
          aspectPreset={aspectPreset}
          assetFolders={assetFolders}
          baseId={baseId}
          busy={busy}
          completedCrop={completedCrop}
          componentImageProps={componentImageProps}
          crop={crop}
          cropAspect={cropAspect}
          cropFrameMode={cropFrameMode}
          estimateNonce={estimateNonce}
          estimatePending={estimatePending}
          estimatedBytes={estimatedBytes}
          fileBaseName={fileBaseName}
          folderActionBusy={folderActionBusy}
          foldersLoading={foldersLoading}
          heightStr={heightStr}
          imageSrc={imageSrc}
          onApplyToCanvas={applyToCanvas}
          onCreateAssetFolder={createAssetFolderNamed}
          onCropComplete={onCropComplete}
          onQualityCommit={() => setEstimateNonce((n) => n + 1)}
          originalBytes={originalBytes}
          outputHeight={outputHeight}
          outputWidth={outputWidth}
          placement={placement}
          quality={quality}
          replaceLibraryAsset={replaceLibraryAsset}
          selectedAssetFolderId={selectedAssetFolderId}
          selectedComponentImagePropId={selectedComponentImagePropId}
          selectedElementType={selectedElementType}
          componentImagePropsResolving={componentImagePropsResolving}
          setAspectPreset={setAspectPreset}
          setCrop={setCrop}
          setCropFrameMode={setCropFrameMode}
          setFileBaseName={setFileBaseName}
          setHeightStr={setHeightStr}
          setOutputHeight={setOutputHeight}
          setOutputWidth={setOutputWidth}
          setPlacement={setPlacement}
          setQuality={setQuality}
          setReplaceLibraryAsset={setReplaceLibraryAsset}
          setSelectedAssetFolderId={setSelectedAssetFolderId}
          setSelectedComponentImagePropId={setSelectedComponentImagePropId}
          setWidthStr={setWidthStr}
          setZoom={setZoom}
          widthStr={widthStr}
          zoom={zoom}
        />
      </>
    ) : null;

  const dissolving = dissolve.phase === "dissolving";

  return (
    <ScrollArea className="h-full min-h-0 flex-1">
      <div className="flex flex-col gap-0 pb-1">
        <section className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            disabled={dissolving}
            id={fileInputId}
            aria-label="Choose image file"
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={(e) => queueFile(e.target.files?.[0])}
          />
          {dissolving ? (
            <div className="relative flex min-w-0 flex-col gap-3">
              {!showIncomingPreview ? (
                <div
                  className={cn(
                    "flex min-w-0 flex-col gap-3",
                    OUTGOING_FADE_CLASS,
                    beginOutgoingFade ? "pointer-events-none opacity-0 delay-[160ms]" : "opacity-100 delay-0"
                  )}
                  onTransitionEnd={handleOutgoingFadeComplete}
                >
                  {loadedEditor ? (
                    loadedEditor
                  ) : (
                    <EmptyImageSourceSection
                      dropZoneLabelClass={dropZoneLabelClass}
                      fileInputId={fileInputId}
                      handleDrag={handleDrag}
                      handleDragState={handleDragState}
                      handleDrop={handleDrop}
                    />
                  )}
                </div>
              ) : (
                <div className="rounded-xl bg-background/80 p-3 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)] ring-1 ring-foreground/10 backdrop-blur-sm">
                  <IncomingDissolvePreview
                    entered={incomingEnter}
                    fileBaseName={sanitizeAssetBaseName(
                      (() => {
                        const n = dissolve.incomingFile.name;
                        const stem = n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : n;
                        return stem || "edited";
                      })()
                    )}
                    imageUrl={dissolve.incomingUrl}
                    onEntranceComplete={finishDissolve}
                  />
                </div>
              )}
            </div>
          ) : !imageSrc ? (
            <EmptyImageSourceSection
              dropZoneLabelClass={dropZoneLabelClass}
              fileInputId={fileInputId}
              handleDrag={handleDrag}
              handleDragState={handleDragState}
              handleDrop={handleDrop}
            />
          ) : null}
        </section>

        {imageSrc && !dissolving ? <div key={imageSrc}>{loadedEditor}</div> : null}
      </div>
    </ScrollArea>
  );
}
