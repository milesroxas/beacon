import { ThemeToggle } from "@/shared/ui/theme-toggle";

export default function Header() {
  return (
    <div className="relative m-0 flex flex-row items-center justify-between bg-muted px-2 py-1 text-foreground">
      <div aria-hidden className="size-7 shrink-0" />
      <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-medium leading-widest">Beacon</h1>
      <ThemeToggle />
    </div>
  );
}
