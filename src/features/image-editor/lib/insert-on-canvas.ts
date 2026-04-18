function hasAppend(el: AnyElement): boolean {
  return typeof (el as { append?: unknown }).append === "function";
}

export async function placeImageOnCanvasWithAsset(asset: Asset, replaceSelectedImage: boolean): Promise<void> {
  const preset = webflow.elementPresets.Image;
  const selected = await webflow.getSelectedElement();

  if (selected?.type === "Image" && replaceSelectedImage) {
    const img = selected as ImageElement;
    await img.setAsset(asset);
    await webflow.setSelectedElement(img);
    return;
  }

  if (selected?.type === "Image" && !replaceSelectedImage) {
    const created = (await selected.after(preset)) as ImageElement;
    await created.setAsset(asset);
    await webflow.setSelectedElement(created);
    return;
  }

  if (selected && hasAppend(selected)) {
    const created = (await (
      selected as AnyElement & {
        append: (p: typeof preset) => Promise<AnyElement>;
      }
    ).append(preset)) as ImageElement;
    await created.setAsset(asset);
    await webflow.setSelectedElement(created);
    return;
  }

  if (selected) {
    const created = (await selected.after(preset)) as ImageElement;
    await created.setAsset(asset);
    await webflow.setSelectedElement(created);
    return;
  }

  const all = await webflow.getAllElements();
  const body = all.find((e) => e.type === "Body");
  if (!body) {
    throw new Error("Could not find a Body element on this page.");
  }
  const created = (await body.append(preset)) as ImageElement;
  await created.setAsset(asset);
  await webflow.setSelectedElement(created);
}

export async function placeImageOnCanvas(file: File, replaceSelectedImage: boolean): Promise<void> {
  const asset = await webflow.createAsset(file);
  await placeImageOnCanvasWithAsset(asset, replaceSelectedImage);
}
