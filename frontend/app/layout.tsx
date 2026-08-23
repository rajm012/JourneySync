import "./globals.css";
import Link from "next/link";
import { ThemeToggle } from "./components/ThemeToggle";
import { Navigation } from "./components/Navigation";
import { PresentationMode } from "./components/PresentationMode";

export const metadata = {
  title: "JourneySync — cross-channel customer journey intelligence",
  description:
    "Real-time identity resolution across web, app, call center and branch. Connected data, not more data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Libre Franklin sits in the Franklin Gothic lineage — the typeface of
            American finance and newsprint. IBM Plex Mono carries every figure.
            If the venue is offline the link simply fails and the fallback stack
            in globals.css keeps the design intact. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('js-theme');if(t!=='light'&&t!=='dark'){t='light';}document.documentElement.classList.add(t);if(localStorage.getItem('js-present')==='1'){document.documentElement.classList.add('present');}}catch(e){document.documentElement.classList.add('light');}})();`,
          }}
        />
      </head>
      <body>
        <div className="min-h-screen flex flex-col">
          <header
            className="sticky top-0 z-30 border-b no-print"
            style={{ background: "var(--paper)", borderColor: "var(--rule-strong)" }}
          >
            <div className="shell flex items-center justify-between gap-6 h-14">
              <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0" aria-label="JourneySync home">
                <Mark />
                <span
                  className="font-semibold"
                  style={{ fontSize: "1.0625rem", letterSpacing: "-0.028em", fontWeight: 800 }}
                >
                  JourneySync
                </span>
              </Link>
              <div className="flex items-center gap-3">
                <Navigation />
                <span className="w-px h-5" style={{ background: "var(--rule)" }} />
                <PresentationMode />
                <ThemeToggle />
              </div>
            </div>
          </header>

          <main className="flex-1 w-full pb-14">{children}</main>

          <footer className="border-t no-print" style={{ borderColor: "var(--rule)" }}>
            <div className="shell py-4 flex flex-wrap justify-between gap-x-8 gap-y-1 t-label text-muted">
              <span>Team Cinephiles · JourneySync</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

/** The mark is the product: four channel lanes of unequal length. */
function Mark() {
  return (
    <svg viewBox="0 0 20 20" className="w-5 h-5" aria-hidden="true">
      <rect x="1" y="2.5" width="17" height="2" rx="1" fill="var(--ch-web)" />
      <rect x="1" y="7" width="11" height="2" rx="1" fill="var(--ch-app)" />
      <rect x="1" y="11.5" width="15" height="2" rx="1" fill="var(--ch-call)" />
      <rect x="1" y="16" width="7" height="2" rx="1" fill="var(--ch-branch)" />
    </svg>
  );
}
