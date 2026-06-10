import Image from "next/image";
import Link from "next/link";
import InstallButton from "@/components/InstallButton";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col bg-bg overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 md:px-10 py-4 border-b border-border backdrop-blur-sm sticky top-0 z-40 bg-bg/90">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/SkyVult logo.png" alt="SkyVult" width={32} height={32} className="rounded-lg object-contain" />
          <span className="font-bold text-lg tracking-tight">SkyVult</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link href="/auth" className="btn btn-secondary text-sm px-4 py-1.5 hidden sm:inline-flex">Login</Link>
          <Link href="/auth?mode=register" className="btn btn-primary text-sm px-4 py-1.5">Sign up</Link>
        </nav>
      </header>

      {/* ── Hero — mobile: full-bleed image with text overlay ── */}
      <section className="relative w-full min-h-[88dvh] lg:min-h-0 flex items-end lg:items-center lg:max-w-7xl lg:mx-auto lg:px-16 lg:pt-20 lg:pb-16 lg:gap-10">

        {/* Background image — mobile only */}
        <div className="absolute inset-0 lg:hidden overflow-hidden">
          <Image
            src="/phone.png"
            alt=""
            fill
            className="object-cover object-top scale-110"
            priority
          />
          {/* top blend into nav */}
          <div className="absolute inset-0 bg-gradient-to-b from-bg/80 via-bg/30 to-transparent" />
          {/* strong bottom scrim where the text sits — keeps copy readable */}
          <div className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-bg via-bg/90 to-transparent" />
          {/* side vignette */}
          <div className="absolute inset-0 bg-gradient-to-r from-bg/50 via-transparent to-bg/50" />
        </div>

        {/* Desktop: phone mockup on the right */}
        <div className="hidden lg:block relative flex-shrink-0 w-80 order-last">
          <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full" />
          <Image
            src="/phone.png"
            alt="SkyVult app on mobile"
            width={320}
            height={600}
            className="relative drop-shadow-2xl mx-auto"
            priority
          />
        </div>

        {/* Text — overlays image on mobile, left column on desktop */}
        <div className="relative z-10 flex-1 px-5 pb-12 pt-0 lg:px-0 lg:pb-0 text-center lg:text-left">
          <div className="inline-flex items-center gap-2 bg-accent/15 backdrop-blur-sm border border-accent/30 rounded-full px-3 py-1 text-xs text-accent font-semibold mb-4">
            <span>🎮</span>
            Forex Trading Game • 6 markets • 80% payout
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.1] tracking-tight drop-shadow-lg">
            Play the markets.<br />
            <span className="text-accent">Win higher.</span>
          </h1>
          <p className="text-white/85 lg:text-muted mt-4 text-base sm:text-lg max-w-lg mx-auto lg:mx-0 drop-shadow-md">
            A fast-paced <span className="text-white font-medium">forex trading game</span>. Predict UP or DOWN
            on simulated forex, crypto and commodity markets in{" "}
            <span className="text-white font-medium">Ghana Cedis</span> — win up to 80% per round.
          </p>

          {/* ₵10 minimum callout */}
          <div className="mt-4 inline-flex items-center gap-3 bg-up/10 border border-up/30 rounded-xl px-4 py-2.5">
            <span className="text-up text-2xl font-black leading-none">₵10</span>
            <div className="text-left">
              <div className="text-white text-sm font-semibold leading-none">Minimum trade</div>
              <div className="text-muted text-xs mt-0.5">Anyone can start — no big capital needed</div>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <Link href="/trade" className="btn btn-up text-base px-8 py-3">
              Start Trading Free
            </Link>
            <Link href="/auth?mode=register" className="btn btn-secondary text-base px-8 py-3">
              Create Account
            </Link>
          </div>
          {/* Install to home screen */}
          <div className="mt-6 flex flex-wrap gap-3 justify-center lg:justify-start">
            <InstallButton />
          </div>

          <div className="mt-6 flex items-center gap-5 justify-center lg:justify-start flex-wrap">
            <Badge icon="up.png" label="80% payout" />
            <Badge icon="signal.png" label="Live prices" />
            <Badge icon="cedis.png" label="From ₵10" />
          </div>
        </div>
      </section>

      {/* ── Direction Visual ────────────────────────────────── */}
      <section className="max-w-7xl mx-auto w-full px-5 md:px-16 py-10">
        <div className="card p-6 md:p-10 flex flex-col md:flex-row items-center gap-6 md:gap-8 text-center md:text-left">
          <Image src="/updown.png" alt="Up and Down trading" width={200} height={200} className="w-28 sm:w-36 md:w-48 flex-shrink-0" />
          <div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold">Simple UP or DOWN trading</h2>
            <p className="text-muted mt-3 text-sm sm:text-base max-w-xl">
              Pick a direction, choose your expiry, enter your stake. If the market moves your way,
              you win <span className="text-accent font-semibold">80%</span> profit instantly. No spreads, no hidden fees.
            </p>
            <div className="flex gap-3 mt-5 justify-center md:justify-start">
              <div className="flex items-center gap-2 bg-up/10 border border-up/30 rounded-lg px-4 py-2.5">
                <span className="text-up font-bold text-lg">▲</span>
                <span className="text-up font-semibold text-sm">UP</span>
              </div>
              <div className="flex items-center gap-2 bg-down/10 border border-down/30 rounded-lg px-4 py-2.5">
                <span className="text-down font-bold text-lg">▼</span>
                <span className="text-down font-semibold text-sm">DOWN</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Cards ───────────────────────────────────── */}
      <section className="max-w-7xl mx-auto w-full px-5 md:px-16 pb-12">
        <h2 className="text-center text-xl sm:text-2xl md:text-3xl font-bold mb-6 md:mb-8">Why play SkyVult?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FeatureCard
            img="up.png"
            title="80% Payout"
            body="Win and receive 1.80× your stake instantly. Settled server-side — no manipulation."
          />
          <FeatureCard
            img="signal.png"
            title="Live Price Feed"
            body="Real-time prices for SVX Prime, Alpha, Titan, Quantum, Velocity & Nova — updated every 800ms."
          />
          <FeatureCard
            img="cedis.png"
            title="Ghana Cedis Native"
            body="Trade, deposit and withdraw entirely in GHS ₵. No currency conversion required."
          />
        </div>
      </section>

      {/* ── Install App Banner ──────────────────────────────── */}
      <section className="mx-5 md:mx-16 mb-6 rounded-2xl bg-panel border border-border p-6 md:p-10 flex flex-col sm:flex-row items-center justify-between gap-5 text-center sm:text-left">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Trade anywhere, anytime</h2>
          <p className="text-muted mt-1 text-sm">Install SkyVult on your phone — no app store needed.</p>
        </div>
        <div className="flex-shrink-0">
          <InstallButton className="btn-store px-6 py-3" />
        </div>
      </section>

      {/* ── CTA banner ──────────────────────────────────────── */}
      <section className="mx-5 md:mx-16 mb-16 rounded-2xl bg-gradient-to-r from-accent/20 via-panel to-up/10 border border-border p-7 md:p-12 flex flex-col md:flex-row items-center justify-between gap-5 text-center md:text-left">
        <div>
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold">Start trading from just <span className="text-up">₵10</span></h2>
          <p className="text-muted mt-2 text-sm sm:text-base">Get a free ₵10,000 demo first — then go live with as little as ₵10.</p>
        </div>
        <Link href="/auth?mode=register" className="btn btn-primary text-base px-8 py-3 whitespace-nowrap flex-shrink-0 w-full sm:w-auto">
          Get Started Free
        </Link>
      </section>

      <footer className="border-t border-border py-6 text-center text-muted text-xs px-4 space-y-1">
        <p>SkyVult © {new Date().getFullYear()} · A forex trading game</p>
        <p className="text-muted/70">
          SkyVult is a game of skill on simulated markets — not a licensed broker or investment service.
        </p>
      </footer>
    </main>
  );
}

function Badge({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Image src={`/${icon}`} alt={label} width={20} height={20} className="opacity-80" />
      <span>{label}</span>
    </div>
  );
}

function FeatureCard({ img, title, body }: { img: string; title: string; body: string }) {
  return (
    <div className="card p-6 flex flex-col items-center text-center gap-3 hover:border-accent/40 transition-colors">
      <Image src={`/${img}`} alt={title} width={64} height={64} className="w-12 h-12 sm:w-14 sm:h-14 object-contain" />
      <div className="font-bold text-base sm:text-lg">{title}</div>
      <p className="text-muted text-sm leading-relaxed">{body}</p>
    </div>
  );
}

