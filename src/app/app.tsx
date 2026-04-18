import Header from "@/app/ui/Header";
import { ImageEditor } from "@/features/image-editor";
import { buildInfo } from "@/shared/lib/build-info";
import { ThemeProvider } from "@/shared/providers/theme-provider";
import { TooltipProvider } from "@/shared/ui/tooltip";

export function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="beacon-ui-theme">
      <TooltipProvider delayDuration={200}>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden" data-version={buildInfo.version}>
          <Header />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <ImageEditor />
          </div>
        </main>
      </TooltipProvider>
    </ThemeProvider>
  );
}
