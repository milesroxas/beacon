import { ThemeToggle } from "@/shared/ui/theme-toggle";

const lightLogoSrc = `${import.meta.env.BASE_URL}images/light-logo-beacon.svg`;
const darkLogoSrc = `${import.meta.env.BASE_URL}images/dark-logo-beacon.svg`;

export default function Header() {
  return (
    <div className="relative m-0 flex flex-row items-center justify-between bg-muted px-2 py-1 text-foreground">
      <div aria-hidden className="size-7 shrink-0" />
      <h1 className="absolute left-1/2 m-0 -translate-x-1/2 text-lg font-medium leading-widest">
        <span className="sr-only">Beacon</span>
        <img src={lightLogoSrc} alt="" aria-hidden className="h-4 w-auto dark:hidden" />
        <img src={darkLogoSrc} alt="" aria-hidden className="hidden h-4 w-auto dark:block" />
      </h1>
      <ThemeToggle />
    </div>
  );
}
