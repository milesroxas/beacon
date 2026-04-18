import { ImageEditor } from "@/features/image-editor";
import { buildInfo } from "@/shared/lib/build-info";
import { TooltipProvider } from "@/shared/ui/tooltip";

export function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <main
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-version={buildInfo.version}
      >
        <ImageEditor />
      </main>
    </TooltipProvider>
  );
}
