import Link from "next/link";
import { LEGAL } from "@/lib/legal";

// Shared chrome for the public /terms and /privacy pages: brand header,
// back link, title, "last updated" line, and prose styling for the body.
export default function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-bg text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-panel/95 backdrop-blur">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/SkyVult logo.png" alt={LEGAL.appName} width={26} height={26} className="rounded-lg object-contain" />
          <span className="font-bold text-sm">{LEGAL.appName}</span>
        </Link>
        <Link
          href="/trade"
          className="text-xs text-muted hover:text-white transition-colors"
        >
          ← Back
        </Link>
      </header>

      <article className="max-w-3xl mx-auto px-5 py-8 md:py-12">
        <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
        <p className="text-xs text-muted mt-2">Last updated · {LEGAL.lastUpdated}</p>
        <p className="text-sm text-muted mt-5 leading-relaxed">{intro}</p>

        <div className="legal-body mt-8 space-y-7 text-sm leading-relaxed text-[#d4d9e2]">
          {children}
        </div>

        <footer className="mt-12 pt-6 border-t border-border text-xs text-muted">
          <div className="flex flex-wrap items-center gap-3">
            <span>Questions?</span>
            <Link
              href="/support"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold bg-accent text-black hover:bg-accent/90 transition-colors"
            >
              💬 Message Us
            </Link>
          </div>
          <div className="mt-4 flex gap-4">
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          </div>
        </footer>
      </article>
    </main>
  );
}

// Small helpers for consistent section headings inside the legal body.
export function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-white mb-2">
        {n}. {title}
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
