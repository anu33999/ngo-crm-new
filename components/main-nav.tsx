"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, History, Map, Search, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Search & Audit", short: "Search", icon: Search, match: (p: string) => p === "/" || p.startsWith("/jobs") || p.startsWith("/ngo") },
  { href: "/history", label: "Search History", short: "History", icon: History, match: (p: string) => p.startsWith("/history") },
  { href: "/discovery", label: "Twin-Cities Discovery", short: "Discovery", icon: Compass, match: (p: string) => p.startsWith("/discovery") },
  { href: "/crm", label: "Outreach CRM", short: "CRM", icon: Users, match: (p: string) => p.startsWith("/crm") },
  { href: "/map", label: "Map", short: "Map", icon: Map, match: (p: string) => p.startsWith("/map") },
  { href: "/settings", label: "Export & Settings", short: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
] as const;

export function MainNav() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max items-center gap-1">
        {ITEMS.map(({ href, label, short, icon: Icon, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link
                href={href} aria-current={active ? "page" : undefined}
                className={cn("inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-[var(--brand-active-bg)] font-medium text-[var(--brand-active-fg)] shadow-sm" : "text-[var(--brand-muted)] hover:bg-[color-mix(in_srgb,var(--brand-fg)_12%,transparent)] hover:text-[var(--brand-fg)]")}
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden lg:inline">{label}</span>
                <span className="lg:hidden">{short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const PALETTES = [
  { id: "darkblue", label: "Dark blue", swatch: "#0f2a52" },
  { id: "burgundy", label: "Burgundy", swatch: "#5a1229" },
  { id: "white", label: "White", swatch: "#ffffff" },
  { id: "black", label: "Black", swatch: "#000000" },
] as const;
type Palette = (typeof PALETTES)[number]["id"];

function subscribePalette(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette"] });
  return () => mo.disconnect();
}
function paletteSnapshot(): Palette {
  const cur = document.documentElement.getAttribute("data-palette");
  return PALETTES.some((p) => p.id === cur) ? (cur as Palette) : "darkblue";
}

/** Colour theme picker (three light, burgundy-led palettes). Remembered in this browser. */
export function ThemeToggle() {
  const current = React.useSyncExternalStore<Palette | null>(subscribePalette, paletteSnapshot, () => null);
  function pick(p: Palette) {
    document.documentElement.setAttribute("data-palette", p);
    try { localStorage.setItem("ka-palette", p); } catch { /* storage unavailable: the choice just won't persist */ }
  }
  return (
    <div className="ml-1 flex items-center gap-1 rounded-lg p-1" role="group" aria-label="Colour theme">
      {PALETTES.map((p) => (
        <button key={p.id} type="button" onClick={() => pick(p.id)} aria-pressed={current === p.id} title={p.label} aria-label={`${p.label} theme`}
          className={`size-6 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current === p.id ? "border-[var(--brand-fg)]" : "border-transparent"}`}
          style={{ background: p.swatch, boxShadow: "0 0 0 1px rgba(127,127,127,.6)" }} />
      ))}
    </div>
  );
}
