import { Crop, FolderPlus, Loader2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";

import type { PlacementMode } from "@/features/image-editor/lib/apply-cropped-export";
import { parseOutputDimension } from "@/features/image-editor/lib/apply-cropped-export";
import {
  getImageEditorPlacementReadiness,
  type ImageEditorPlacementBlocker,
} from "@/features/image-editor/lib/image-editor-placement-readiness";
import { sanitizeAssetBaseName } from "@/features/image-editor/lib/sanitize-asset-base-name";
import { ExportSizeEstimate } from "@/features/image-editor/ui/export-size-estimate";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Slider } from "@/shared/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";

export type AspectPreset = "free" | "1" | "16-9" | "4-3" | "3-2" | "9-16";

/** Aspect ratio templates vs. W×H-driven crop frame (same slot in the UI). */
export type CropFrameMode = "aspect" | "custom";

export type ComponentImagePropOption = { propId: string; label: string };

export type AssetFolderRow = {
  id: string;
  name: string;
  /** `parent` folder id, or `null` if this folder sits at the top level of Assets. */
  parentId: string | null;
  /** Full path for display, e.g. `Brand / Logos`. */
  pathLabel: string;
  handle: AssetFolder;
};

export type ImageEditorCropExportPanelProps = {
  baseId: string;
  imageSrc: string;
  cropAspect: number | undefined;
  crop: { x: number; y: number };
  setCrop: (c: { x: number; y: number }) => void;
  zoom: number;
  setZoom: (z: number) => void;
  onCropComplete: (c: Area, px: Area) => void;
  cropFrameMode: CropFrameMode;
  setCropFrameMode: (m: CropFrameMode) => void;
  aspectPreset: AspectPreset;
  setAspectPreset: (p: AspectPreset) => void;
  widthStr: string;
  setWidthStr: (s: string) => void;
  outputWidth: number;
  setOutputWidth: (n: number) => void;
  heightStr: string;
  setHeightStr: (s: string) => void;
  outputHeight: number;
  setOutputHeight: (n: number) => void;
  fileBaseName: string;
  setFileBaseName: (s: string) => void;
  quality: number;
  setQuality: (q: number) => void;
  onQualityCommit: () => void;
  completedCrop: Area | null;
  estimatePending: boolean;
  estimatedBytes: number | null;
  originalBytes: number | null;
  estimateNonce: number;
  assetFolders: AssetFolderRow[];
  foldersLoading: boolean;
  folderActionBusy: boolean;
  selectedAssetFolderId: string | null;
  setSelectedAssetFolderId: (id: string | null) => void;
  onCreateAssetFolder: (name: string, parentFolderId: string | null) => Promise<boolean>;
  placement: PlacementMode;
  setPlacement: (p: PlacementMode) => void;
  replaceLibraryAsset: boolean;
  setReplaceLibraryAsset: (v: boolean) => void;
  componentImageProps: ComponentImagePropOption[];
  selectedComponentImagePropId: string | null;
  setSelectedComponentImagePropId: (id: string | null) => void;
  /** Current canvas selection `element.type` (Designer API), for placement validation. */
  selectedElementType: string | null;
  /** True while resolving image fields for the selected component instance. */
  componentImagePropsResolving: boolean;
  busy: boolean;
  onApplyToCanvas: () => void | Promise<void>;
};

/** Fade + slide down into place; `delayMs` staggers rows below the crop preview. */
function staggerBelowCropClass(entered: boolean, delayMs: number) {
  return cn(
    "transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform]",
    entered ? "translate-y-0 opacity-100" : "-translate-y-2.5 opacity-0 [transition-delay:0ms]",
    entered && `[transition-delay:${delayMs}ms]`
  );
}

const PLACEMENT_OPTIONS: {
  value: PlacementMode;
  title: string;
  description: string;
}[] = [
  {
    value: "canvas",
    title: "Page",
    description: "Append to the page (selection ignored).",
  },
  {
    value: "selection",
    title: "Selection",
    description: "Near the selected element, or a component image field.",
  },
  {
    value: "replace",
    title: "Replace",
    description: "Swap the image on the selected Image element.",
  },
];

type PlaceButtonState = {
  disabled: boolean;
  label: string;
  busy: boolean;
};

const IMAGE_EDITOR_PLACEMENT_BLOCKER_LABELS: Record<ImageEditorPlacementBlocker, string> = {
  "missing-crop": "Adjust crop first",
  "replace-wrong-type": "Select an image",
  "selection-empty": "Select an element",
  "selection-props-loading": "Syncing selection…",
  "selection-pick-field": "Choose a field",
};

function placeButtonStateForPlacement(p: {
  busy: boolean;
  foldersLoading: boolean;
  selectedAssetFolderId: string | null;
  completedCrop: Area | null;
  placement: PlacementMode;
  selectedElementType: string | null;
  componentImagePropsResolving: boolean;
  componentImagePropCount: number;
  selectedComponentImagePropId: string | null;
}): PlaceButtonState {
  const {
    busy,
    foldersLoading,
    selectedAssetFolderId,
    completedCrop,
    placement,
    selectedElementType,
    componentImagePropsResolving,
    componentImagePropCount,
    selectedComponentImagePropId,
  } = p;

  if (busy) {
    return { disabled: true, label: "Placing…", busy: true };
  }
  if (foldersLoading) {
    return { disabled: true, label: "Loading folders…", busy: false };
  }
  if (selectedAssetFolderId === null) {
    return { disabled: true, label: "Choose a folder", busy: false };
  }

  const readiness = getImageEditorPlacementReadiness({
    placement,
    hasCompletedCrop: completedCrop != null,
    selectedElementType,
    componentImagePropsResolving,
    componentImagePropCount,
    selectedComponentImagePropId,
  });

  if (!readiness.ok) {
    return {
      disabled: true,
      label: IMAGE_EDITOR_PLACEMENT_BLOCKER_LABELS[readiness.blocker],
      busy: false,
    };
  }

  if (placement === "canvas") {
    return { disabled: false, label: "Add to page", busy: false };
  }
  if (placement === "replace") {
    return { disabled: false, label: "Replace image", busy: false };
  }
  return { disabled: false, label: "Place image", busy: false };
}

function StepBadge({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[0.7rem] font-semibold text-primary-foreground tabular-nums shadow-sm"
        aria-hidden
      >
        {n}
      </span>
      <span className="text-sm font-medium leading-none">{label}</span>
    </div>
  );
}

type CropStageProps = {
  baseId: string;
  imageSrc: string;
  cropAspect: number | undefined;
  crop: { x: number; y: number };
  setCrop: (c: { x: number; y: number }) => void;
  zoom: number;
  setZoom: (z: number) => void;
  onCropComplete: (c: Area, px: Area) => void;
  belowCropEntered: boolean;
  cropFrameMode: CropFrameMode;
  setCropFrameMode: (m: CropFrameMode) => void;
  aspectPreset: AspectPreset;
  setAspectPreset: (p: AspectPreset) => void;
  widthStr: string;
  setWidthStr: (s: string) => void;
  outputWidth: number;
  setOutputWidth: (n: number) => void;
  heightStr: string;
  setHeightStr: (s: string) => void;
  outputHeight: number;
  setOutputHeight: (n: number) => void;
};

function CropStageSection(p: CropStageProps) {
  const {
    baseId,
    imageSrc,
    cropAspect,
    crop,
    setCrop,
    zoom,
    setZoom,
    onCropComplete,
    belowCropEntered,
    cropFrameMode,
    setCropFrameMode,
    aspectPreset,
    setAspectPreset,
    widthStr,
    setWidthStr,
    outputWidth,
    setOutputWidth,
    heightStr,
    setHeightStr,
    outputHeight,
    setOutputHeight,
  } = p;

  return (
    <section className="mt-4 flex flex-col gap-3" aria-labelledby={`${baseId}-step-crop`}>
      <h2 className="sr-only" id={`${baseId}-step-crop`}>
        Step 1: Crop
      </h2>
      <StepBadge n={1} label="Crop" />
      <Card size="sm">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-sm font-medium">Crop area</CardTitle>
          <CardDescription>Drag to reposition and choose what gets exported.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/30">
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

          <div className={staggerBelowCropClass(belowCropEntered, 0)}>
            <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium" htmlFor={`${baseId}-frame-mode`}>
                  Frame
                </Label>
                <p className="text-muted-foreground text-xs leading-snug">
                  Presets lock aspect ratio. Custom matches your output width and height.
                </p>
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
                <ToggleGroupItem value="aspect">Presets</ToggleGroupItem>
                <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
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
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs" htmlFor={`${baseId}-ow`}>
                        Width (px)
                      </Label>
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
                      <Label className="text-xs" htmlFor={`${baseId}-oh`}>
                        Height (px)
                      </Label>
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
                  <p className="text-muted-foreground text-xs leading-snug">Use values from 1 to 8192 px per side.</p>
                </div>
              )}
            </div>
          </div>

          <div className={staggerBelowCropClass(belowCropEntered, 90)}>
            <div className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium" htmlFor={`${baseId}-zoom`}>
                  Zoom
                </Label>
                <span className="text-muted-foreground text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              </div>
              <Slider
                id={`${baseId}-zoom`}
                min={1}
                max={4}
                step={0.01}
                value={[zoom]}
                onValueChange={(v) => setZoom(v[0] ?? 1)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

type ExportCardProps = {
  baseId: string;
  fileBaseName: string;
  setFileBaseName: (s: string) => void;
  quality: number;
  setQuality: (q: number) => void;
  onQualityCommit: () => void;
  completedCrop: Area | null;
  estimatePending: boolean;
  estimatedBytes: number | null;
  originalBytes: number | null;
  estimateNonce: number;
};

function ExportEncodeCard(p: ExportCardProps) {
  const {
    baseId,
    fileBaseName,
    setFileBaseName,
    quality,
    setQuality,
    onQualityCommit,
    completedCrop,
    estimatePending,
    estimatedBytes,
    originalBytes,
    estimateNonce,
  } = p;

  return (
    <section className="mt-4 flex flex-col gap-3" aria-labelledby={`${baseId}-step-export`}>
      <h2 className="sr-only" id={`${baseId}-step-export`}>
        Step 2: Export
      </h2>
      <StepBadge n={2} label="Export" />
      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">File & quality</CardTitle>
          <CardDescription>Name and compression before upload.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor={`${baseId}-fn`}>
              File name
            </Label>
            <Input
              id={`${baseId}-fn`}
              aria-label="Exported file base name"
              autoComplete="off"
              value={fileBaseName}
              onChange={(e) => setFileBaseName(e.target.value)}
              onBlur={() => setFileBaseName(sanitizeAssetBaseName(fileBaseName))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs" htmlFor={`${baseId}-quality`}>
              Quality
            </Label>
            <Slider
              id={`${baseId}-quality`}
              min={0.05}
              max={1}
              step={0.01}
              value={[quality]}
              onValueChange={(v) => setQuality(v[0] ?? 0.75)}
              onValueCommit={onQualityCommit}
            />
            <ExportSizeEstimate
              completedCrop={completedCrop}
              estimatePending={estimatePending}
              estimatedBytes={estimatedBytes}
              originalBytes={originalBytes}
              showQualityCommitHint={completedCrop !== null && estimateNonce === 0}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

type AssetFolderCardProps = {
  baseId: string;
  assetFolders: AssetFolderRow[];
  foldersLoading: boolean;
  folderActionBusy: boolean;
  busy: boolean;
  selectedAssetFolderId: string | null;
  setSelectedAssetFolderId: (id: string | null) => void;
  onCreateAssetFolder: (name: string, parentFolderId: string | null) => Promise<boolean>;
};

function getFolderStatusText(assetFolders: AssetFolderRow[], selectedAssetFolderId: string | null): string {
  if (assetFolders.length === 0) {
    return "No folders yet — create one to continue.";
  }

  const folderCountLabel = `${assetFolders.length} folder${assetFolders.length === 1 ? "" : "s"} available`;
  if (selectedAssetFolderId === null) {
    return folderCountLabel;
  }

  const selectedFolderPathLabel = assetFolders.find((folder) => folder.id === selectedAssetFolderId)?.pathLabel;
  if (!selectedFolderPathLabel) {
    return folderCountLabel;
  }
  return `${selectedFolderPathLabel} · ${folderCountLabel}`;
}

function AssetDestinationCard(p: AssetFolderCardProps) {
  const {
    baseId,
    assetFolders,
    foldersLoading,
    folderActionBusy,
    busy,
    selectedAssetFolderId,
    setSelectedAssetFolderId,
    onCreateAssetFolder,
  } = p;

  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  /** Where the new folder is created: site root vs under a folder chosen in the modal. */
  const [newFolderParent, setNewFolderParent] = useState<"root" | "child">("root");
  const [newFolderParentFolderId, setNewFolderParentFolderId] = useState<string | null>(null);
  const newFolderFieldId = useId();
  const newFolderParentFieldId = `${baseId}-new-folder-parent`;
  const folderFieldId = `${baseId}-asset-folder`;
  const newFolderRootId = `${baseId}-new-folder-root`;
  const newFolderChildId = `${baseId}-new-folder-child`;

  const folderSelectDisabled = folderActionBusy || busy || foldersLoading;
  const newFolderButtonDisabled = folderActionBusy || busy;
  const hasAvailableParentFolders = assetFolders.length > 0;
  const folderStatusText = getFolderStatusText(assetFolders, selectedAssetFolderId);

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      return;
    }
    const parentFolderId = newFolderParent === "child" ? newFolderParentFolderId : null;
    if (newFolderParent === "child" && !parentFolderId) {
      return;
    }
    const ok = await onCreateAssetFolder(name, parentFolderId);
    if (ok) {
      setNewFolderName("");
      setNewFolderDialogOpen(false);
    }
  };

  return (
    <section className="mt-4 flex flex-col gap-3" aria-labelledby={`${baseId}-step-assets`}>
      <h2 className="sr-only" id={`${baseId}-step-assets`}>
        Step 3: Assets folder
      </h2>
      <StepBadge n={3} label="Save to Assets" />
      <Card size="sm">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-sm font-medium">Destination folder</CardTitle>
          <CardDescription className="text-xs leading-snug">
            Pick a folder for this upload. Paths show nested names.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3">
            <Label className="text-xs font-medium" htmlFor={folderFieldId}>
              Folder
            </Label>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={selectedAssetFolderId ?? undefined}
                  onValueChange={(v) => {
                    setSelectedAssetFolderId(v);
                  }}
                  disabled={folderSelectDisabled}
                >
                  <SelectTrigger id={folderFieldId} size="full">
                    <SelectValue placeholder="Choose a folder" />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width)">
                    {assetFolders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.pathLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Dialog
                open={newFolderDialogOpen}
                onOpenChange={(open) => {
                  setNewFolderDialogOpen(open);
                  if (open) {
                    setNewFolderName("");
                    setNewFolderParent(selectedAssetFolderId ? "child" : "root");
                    setNewFolderParentFolderId(selectedAssetFolderId);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label="Create folder"
                    disabled={newFolderButtonDisabled}
                  >
                    <FolderPlus aria-hidden className="size-3.5" />
                    <span className="sr-only">Create folder</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm" showCloseButton>
                  <DialogHeader>
                    <DialogTitle>New folder</DialogTitle>
                    <DialogDescription>Name and location.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 py-1">
                    <RadioGroup
                      className="flex flex-col gap-2"
                      value={newFolderParent}
                      onValueChange={(v) => {
                        const nextParent = v as "root" | "child";
                        setNewFolderParent(nextParent);
                        if (nextParent === "child" && !newFolderParentFolderId && hasAvailableParentFolders) {
                          setNewFolderParentFolderId(selectedAssetFolderId ?? assetFolders[0]?.id ?? null);
                        }
                      }}
                    >
                      <label
                        htmlFor={newFolderRootId}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent p-2 hover:bg-muted/50"
                      >
                        <RadioGroupItem value="root" id={newFolderRootId} />
                        <span className="text-sm">Top level</span>
                      </label>
                      <label
                        htmlFor={newFolderChildId}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md border border-transparent p-2",
                          hasAvailableParentFolders
                            ? "cursor-pointer hover:bg-muted/50"
                            : "cursor-not-allowed opacity-60"
                        )}
                      >
                        <RadioGroupItem value="child" id={newFolderChildId} disabled={!hasAvailableParentFolders} />
                        <span className="text-sm">Inside folder</span>
                      </label>
                    </RadioGroup>
                    {!hasAvailableParentFolders ? (
                      <p className="text-muted-foreground text-xs">No folders yet. Create a top-level folder first.</p>
                    ) : null}
                    {newFolderParent === "child" && hasAvailableParentFolders ? (
                      <div className="grid gap-2">
                        <Label className="text-xs" htmlFor={newFolderParentFieldId}>
                          Parent folder
                        </Label>
                        <Select
                          value={newFolderParentFolderId ?? undefined}
                          onValueChange={(v) => setNewFolderParentFolderId(v)}
                          disabled={folderActionBusy}
                        >
                          <SelectTrigger id={newFolderParentFieldId} size="full">
                            <SelectValue placeholder="Choose a parent folder" />
                          </SelectTrigger>
                          <SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width)">
                            {assetFolders.map((folder) => (
                              <SelectItem key={folder.id} value={folder.id}>
                                {folder.pathLabel}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    <div className="grid gap-2">
                      <Label className="text-xs" htmlFor={newFolderFieldId}>
                        Name
                      </Label>
                      <Input
                        id={newFolderFieldId}
                        placeholder="e.g. Campaign images"
                        value={newFolderName}
                        disabled={folderActionBusy}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void submitNewFolder();
                          }
                        }}
                      />
                    </div>
                  </div>
                  <DialogFooter className="flex-row justify-end">
                    <DialogClose asChild>
                      <Button type="button" variant="outline">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button
                      type="button"
                      disabled={
                        folderActionBusy ||
                        !newFolderName.trim() ||
                        (newFolderParent === "child" && !newFolderParentFolderId)
                      }
                      onClick={() => void submitNewFolder()}
                    >
                      {folderActionBusy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : "Create"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {foldersLoading ? (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" />
                Loading folders…
              </p>
            ) : (
              <p className="text-muted-foreground text-xs tabular-nums">{folderStatusText}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

type PlacementCardProps = {
  baseId: string;
  placement: PlacementMode;
  setPlacement: (p: PlacementMode) => void;
  replaceLibraryAsset: boolean;
  setReplaceLibraryAsset: (v: boolean) => void;
  componentImageProps: ComponentImagePropOption[];
  selectedComponentImagePropId: string | null;
  setSelectedComponentImagePropId: (id: string | null) => void;
};

function PlacementCard(p: PlacementCardProps) {
  const {
    baseId,
    placement,
    setPlacement,
    replaceLibraryAsset,
    setReplaceLibraryAsset,
    componentImageProps,
    selectedComponentImagePropId,
    setSelectedComponentImagePropId,
  } = p;

  return (
    <section className="mt-4 flex flex-col gap-3" aria-labelledby={`${baseId}-step-place`}>
      <h2 className="sr-only" id={`${baseId}-step-place`}>
        Step 4: Placement
      </h2>
      <StepBadge n={4} label="Place on canvas" />
      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Placement</CardTitle>
          <CardDescription>How the image is added after upload.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <RadioGroup
            className="flex flex-col gap-3"
            value={placement}
            onValueChange={(v) => setPlacement(v as PlacementMode)}
          >
            {PLACEMENT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                htmlFor={`${baseId}-place-${opt.value}`}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border border-transparent p-2.5 ring-1 ring-foreground/10 transition-colors",
                  placement === opt.value ? "bg-accent/50 border-primary/30" : "hover:bg-muted/40"
                )}
              >
                <RadioGroupItem className="mt-0.5" id={`${baseId}-place-${opt.value}`} value={opt.value} />
                <span className="min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-medium leading-none">{opt.title}</span>
                  <span className="text-muted-foreground text-xs leading-snug">{opt.description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>

          {placement === "replace" ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${baseId}-lib-replace`}
                checked={replaceLibraryAsset}
                onCheckedChange={(v) => setReplaceLibraryAsset(v === true)}
              />
              <Label className="cursor-pointer font-normal" htmlFor={`${baseId}-lib-replace`}>
                Update Assets file
              </Label>
            </div>
          ) : null}

          {placement === "selection" && componentImageProps.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs" htmlFor={`${baseId}-comp-prop`}>
                Component field
              </Label>
              {componentImageProps.length === 1 ? (
                <p className="text-xs leading-snug" id={`${baseId}-comp-prop`}>
                  {componentImageProps[0].label}
                </p>
              ) : (
                <RadioGroup
                  id={`${baseId}-comp-prop`}
                  value={selectedComponentImagePropId ?? ""}
                  onValueChange={(v) => setSelectedComponentImagePropId(v)}
                >
                  {componentImageProps.map((o) => (
                    <div key={o.propId} className="flex items-center gap-2">
                      <RadioGroupItem value={o.propId} id={`${baseId}-comp-${o.propId}`} />
                      <Label className="font-normal" htmlFor={`${baseId}-comp-${o.propId}`}>
                        {o.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

export function ImageEditorCropExportPanel(props: ImageEditorCropExportPanelProps) {
  const {
    baseId,
    imageSrc,
    cropAspect,
    crop,
    setCrop,
    zoom,
    setZoom,
    onCropComplete,
    cropFrameMode,
    setCropFrameMode,
    aspectPreset,
    setAspectPreset,
    widthStr,
    setWidthStr,
    outputWidth,
    setOutputWidth,
    heightStr,
    setHeightStr,
    outputHeight,
    setOutputHeight,
    fileBaseName,
    setFileBaseName,
    quality,
    setQuality,
    onQualityCommit,
    completedCrop,
    estimatePending,
    estimatedBytes,
    originalBytes,
    estimateNonce,
    assetFolders,
    foldersLoading,
    folderActionBusy,
    selectedAssetFolderId,
    setSelectedAssetFolderId,
    onCreateAssetFolder,
    placement,
    setPlacement,
    replaceLibraryAsset,
    setReplaceLibraryAsset,
    componentImageProps,
    selectedComponentImagePropId,
    setSelectedComponentImagePropId,
    selectedElementType,
    componentImagePropsResolving,
    busy,
    onApplyToCanvas,
  } = props;

  const placeButton = useMemo(
    () =>
      placeButtonStateForPlacement({
        busy,
        foldersLoading,
        selectedAssetFolderId,
        completedCrop,
        placement,
        selectedElementType,
        componentImagePropsResolving,
        componentImagePropCount: componentImageProps.length,
        selectedComponentImagePropId,
      }),
    [
      busy,
      foldersLoading,
      selectedAssetFolderId,
      completedCrop,
      placement,
      selectedElementType,
      componentImagePropsResolving,
      componentImageProps.length,
      selectedComponentImagePropId,
    ]
  );

  const [belowCropEntered, setBelowCropEntered] = useState(false);

  useLayoutEffect(() => {
    void imageSrc;
    setBelowCropEntered(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setBelowCropEntered(true);
      });
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [imageSrc]);

  useEffect(() => {
    if (placement !== "replace") {
      setReplaceLibraryAsset(false);
    }
  }, [placement, setReplaceLibraryAsset]);

  return (
    <>
      <CropStageSection
        baseId={baseId}
        imageSrc={imageSrc}
        cropAspect={cropAspect}
        crop={crop}
        setCrop={setCrop}
        zoom={zoom}
        setZoom={setZoom}
        onCropComplete={onCropComplete}
        belowCropEntered={belowCropEntered}
        cropFrameMode={cropFrameMode}
        setCropFrameMode={setCropFrameMode}
        aspectPreset={aspectPreset}
        setAspectPreset={setAspectPreset}
        widthStr={widthStr}
        setWidthStr={setWidthStr}
        outputWidth={outputWidth}
        setOutputWidth={setOutputWidth}
        heightStr={heightStr}
        setHeightStr={setHeightStr}
        outputHeight={outputHeight}
        setOutputHeight={setOutputHeight}
      />

      <ExportEncodeCard
        baseId={baseId}
        fileBaseName={fileBaseName}
        setFileBaseName={setFileBaseName}
        quality={quality}
        setQuality={setQuality}
        onQualityCommit={onQualityCommit}
        completedCrop={completedCrop}
        estimatePending={estimatePending}
        estimatedBytes={estimatedBytes}
        originalBytes={originalBytes}
        estimateNonce={estimateNonce}
      />

      <AssetDestinationCard
        baseId={baseId}
        assetFolders={assetFolders}
        foldersLoading={foldersLoading}
        folderActionBusy={folderActionBusy}
        busy={busy}
        selectedAssetFolderId={selectedAssetFolderId}
        setSelectedAssetFolderId={setSelectedAssetFolderId}
        onCreateAssetFolder={onCreateAssetFolder}
      />

      <PlacementCard
        baseId={baseId}
        placement={placement}
        setPlacement={setPlacement}
        replaceLibraryAsset={replaceLibraryAsset}
        setReplaceLibraryAsset={setReplaceLibraryAsset}
        componentImageProps={componentImageProps}
        selectedComponentImagePropId={selectedComponentImagePropId}
        setSelectedComponentImagePropId={setSelectedComponentImagePropId}
      />

      <div className="mt-6 flex flex-col gap-2">
        <Button type="button" className="w-full" disabled={placeButton.disabled} onClick={() => void onApplyToCanvas()}>
          {placeButton.busy ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {placeButton.label}
            </>
          ) : (
            <>
              <Crop aria-hidden className="size-4" />
              {placeButton.label}
            </>
          )}
        </Button>
      </div>
    </>
  );
}
