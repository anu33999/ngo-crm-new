import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { MainNav, ThemeToggle } from "@/components/main-nav";
import { NgoDataProvider } from "@/components/crm/ngo-data";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kreatif Atelier — NGO Intelligence", template: "%s · Kreatif Atelier" },
  description: "NGO research, regional discovery, outreach CRM and digital audit workspace for Kreatif Atelier.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Applies a saved theme before first paint so there is no flash. Falls back to the system setting.
const THEME_BOOT = `try{var t=localStorage.getItem("ka-palette");if(["darkblue","burgundy","white","black"].indexOf(t)>=0)document.documentElement.setAttribute("data-palette",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>
        <NgoDataProvider>
          <header className="brand-bar sticky top-0 z-40">
            <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="brand-mark" aria-hidden>KA</span>
                <span className="flex flex-col leading-tight">
                  <span className="font-serif text-lg tracking-tight">Kreatif Atelier</span>
                  <span className="hidden text-[10px] uppercase tracking-[0.22em] text-[var(--brand-muted)] sm:inline">NGO Intelligence</span>
                </span>
              </Link>
              <div className="flex min-w-0 items-center gap-1"><MainNav /><ThemeToggle /></div>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[96rem] flex-1 px-3 py-5 sm:px-5 sm:py-7"><div className="canvas">{children}</div></main>
          <footer className="border-t border-border page-ink-muted">
            <p className="mx-auto max-w-[96rem] px-4 py-4 text-xs sm:px-6">Drafts only — nothing is sent automatically. Findings rest on public information and say how sure they are.</p>
          </footer>
        </NgoDataProvider>
      </body>
    </html>
  );
}
