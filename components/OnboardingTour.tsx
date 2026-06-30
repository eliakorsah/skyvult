"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export const TOUR_LS_KEY = "skyvult_tour_v2";
const PAD = 12;
const ARROW = 10;

type Step = {
  emoji: string;
  title: string;
  body: string;
  target?: string;
  label?: string;
};

const STEPS: Step[] = [
  {
    emoji: "👋",
    title: "Welcome to SkyVult",
    body: "You have ₵10,000 demo balance to claim and practise with — zero real money at risk. Let us walk you through the platform in 6 quick steps.",
  },
  {
    emoji: "📊",
    title: "Choose Your Asset",
    body: "Scroll these tabs to pick what you want to trade — SVX Prime, SVX Titan, SVX Velocity and more. The live price next to each tab updates every tick.",
    target: "assets",
    label: "Asset Tabs",
  },
  {
    emoji: "📈",
    title: "Live Price Chart",
    body: "Prices move at 20 ticks per second. Green candles = price rose, red = price fell. Watch the movement and look for a pattern before placing a trade.",
    target: "chart",
    label: "Live Chart",
  },
  {
    emoji: "⏱",
    title: "Expiry Time",
    body: "How long your trade runs — from 5 seconds to 5 minutes. Your prediction must be correct when the timer reaches zero for you to win.",
    target: "expiry",
    label: "Expiry",
  },
  {
    emoji: "💰",
    title: "Trade Amount",
    body: "How much you stake per trade. Minimum is ₵10. The payout and profit figures update instantly as you adjust the amount.",
    target: "amount",
    label: "Amount",
  },
  {
    emoji: "🎯",
    title: "Place Your Trade",
    body: "Think price will rise? Tap BUY ↗. Think it will fall? Tap SELL ↘. Correct at expiry = you win the full payout shown above the buttons.",
    target: "trade-buttons",
    label: "BUY / SELL",
  },
  {
    emoji: "🏆",
    title: "You're All Set!",
    body: "Start on Demo to practise for free. Switch to Real mode any time from the toggle in the top right. Trade smart — good luck.",
  },
];

type Rect = { top: number; left: number; right: number; bottom: number; w: number; h: number };

function measure(target: string, pad: number): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top:    Math.max(0, r.top    - pad),
    left:   Math.max(0, r.left   - pad),
    right:  Math.min(window.innerWidth,  r.right  + pad),
    bottom: Math.min(window.innerHeight, r.bottom + pad),
    w: r.width  + pad * 2,
    h: r.height + pad * 2,
  };
}

export default function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [hl, setHl] = useState<Rect | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(TOUR_LS_KEY)) return;
    const t = setTimeout(() => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      setVisible(true);
    }, 900);
    return () => clearTimeout(t);
  }, []);

  const current = STEPS[step];

  useEffect(() => {
    if (!visible) return;

    if (!current.target) {
      setHl(null);
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      return;
    }

    const el = document.querySelector(`[data-tour="${current.target}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });

    function refresh() {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      const r = measure(current.target!, PAD);
      if (r) setHl(r);
    }

    refresh();
    const t = setTimeout(refresh, 320);
    window.addEventListener("resize", refresh);
    return () => { clearTimeout(t); window.removeEventListener("resize", refresh); };
  }, [step, visible, current.target]);

  function dismiss() {
    localStorage.setItem(TOUR_LS_KEY, "1");
    setVisible(false);
    window.dispatchEvent(new Event("skyvult-tour-done"));
  }

  function next() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else dismiss();
  }

  function prev() {
    if (step > 0) setStep((s) => s - 1);
  }

  if (!visible || vw === 0) return null;

  const CARD_H = 200;
  const MARGIN = 12;

  // Pick the side with more room. If neither fits, centre the card.
  const spaceBelow = hl ? vh - hl.bottom - MARGIN : 0;
  const spaceAbove = hl ? hl.top - MARGIN : 0;
  const cardBelow  = hl ? spaceBelow >= spaceAbove : false;
  const fits       = hl ? Math.max(spaceBelow, spaceAbove) >= CARD_H : false;

  let cardStyle: React.CSSProperties;
  if (!hl || !fits) {
    // No target, or neither side has room — centre on screen
    cardStyle = {
      position: "fixed",
      left: MARGIN,
      right: MARGIN,
      top: Math.round(vh / 2 - CARD_H / 2),
      zIndex: 9999,
    };
  } else if (cardBelow) {
    cardStyle = {
      position: "fixed",
      left: MARGIN,
      right: MARGIN,
      top: hl.bottom + ARROW + MARGIN,
      zIndex: 9999,
    };
  } else {
    cardStyle = {
      position: "fixed",
      left: MARGIN,
      right: MARGIN,
      bottom: vh - hl.top + ARROW + MARGIN,
      zIndex: 9999,
    };
  }

  return (
    <div className="fixed inset-0" style={{ zIndex: 9998, pointerEvents: "auto" }}>

      {/* ── Overlay: 4 panels leaving the target element completely untouched ── */}
      {hl ? (
        <>
          {/* top */}
          <div className="fixed left-0 right-0" style={{ top: 0, height: hl.top, background: "rgba(4,6,12,0.88)", pointerEvents: "none" }} />
          {/* bottom */}
          <div className="fixed left-0 right-0" style={{ top: hl.bottom, bottom: 0, background: "rgba(4,6,12,0.88)", pointerEvents: "none" }} />
          {/* left */}
          <div className="fixed" style={{ top: hl.top, height: hl.h, left: 0, width: hl.left, background: "rgba(4,6,12,0.88)", pointerEvents: "none" }} />
          {/* right */}
          <div className="fixed" style={{ top: hl.top, height: hl.h, left: hl.right, right: 0, background: "rgba(4,6,12,0.88)", pointerEvents: "none" }} />
        </>
      ) : (
        <div className="fixed inset-0" style={{ background: "rgba(4,6,12,0.88)", pointerEvents: "none" }} />
      )}

      {/* ── Gold border + glow around the exposed element ── */}
      {hl && (
        <div
          className="fixed pointer-events-none rounded-xl"
          style={{
            top: hl.top,
            left: hl.left,
            width: hl.w,
            height: hl.h,
            outline: "2px solid #f7a600",
            outlineOffset: "0px",
            boxShadow: "0 0 0 4px rgba(247,166,0,0.15), 0 0 28px 6px rgba(247,166,0,0.2)",
            zIndex: 9999,
          }}
        />
      )}

      {/* ── Dashed connector line — only when card has a clear direction ── */}
      {hl && fits && vw > 0 && (
        <svg
          className="fixed inset-0 pointer-events-none"
          width={vw}
          height={vh}
          style={{ zIndex: 9999 }}
        >
          <line
            x1={vw / 2}
            y1={cardBelow ? hl.bottom + ARROW : hl.top - ARROW}
            x2={hl.left + hl.w / 2}
            y2={cardBelow ? hl.bottom : hl.top}
            stroke="#f7a600"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            opacity={0.45}
          />
        </svg>
      )}

      {/* ── Floating label badge ── */}
      <AnimatePresence>
        {hl && current.label && (
          <motion.div
            key={`lbl-${step}`}
            initial={{ opacity: 0, y: cardBelow ? -6 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed pointer-events-none"
            style={{
              left: hl.left,
              top: cardBelow ? hl.top - 28 : hl.bottom + 6,
              zIndex: 9999,
            }}
          >
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide"
              style={{ background: "#f7a600", color: "#000" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-black/30" />
              {current.label}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Step card ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`card-${step}`}
          initial={{ opacity: 0, y: cardBelow ? 12 : -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: cardBelow ? -6 : 6 }}
          transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
          style={cardStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Arrow tip — only shown when card isn't centred */}
          {hl && fits && (
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={
                cardBelow
                  ? { top: -ARROW, width: 0, height: 0, borderLeft: `${ARROW}px solid transparent`, borderRight: `${ARROW}px solid transparent`, borderBottom: `${ARROW}px solid #2c3340` }
                  : { bottom: -ARROW, width: 0, height: 0, borderLeft: `${ARROW}px solid transparent`, borderRight: `${ARROW}px solid transparent`, borderTop: `${ARROW}px solid #2c3340` }
              }
            />
          )}

          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "#2c3340",
              border: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(247,166,0,0.1)",
            }}
          >
            {/* Top accent bar */}
            <div style={{ height: 2, background: "linear-gradient(90deg,transparent,#f7a600 40%,transparent)" }} />

            <div className="p-5">
              {/* Header row */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "#f7a600" }}>
                  Step {step + 1} / {STEPS.length}
                </span>
                {/* Progress dots */}
                <div className="flex items-center gap-1">
                  {STEPS.map((_, i) => (
                    <motion.div
                      key={i}
                      className="rounded-full"
                      animate={{ width: i === step ? 18 : 5, opacity: i < step ? 0.4 : i === step ? 1 : 0.2 }}
                      style={{ height: 5, background: "#f7a600" }}
                      transition={{ duration: 0.25 }}
                    />
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="text-2xl mb-2.5">{current.emoji}</div>
              <h2 className="font-bold text-[15px] text-white mb-2 leading-snug">{current.title}</h2>
              <p className="text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                {current.body}
              </p>

              {/* Footer */}
              <div
                className="flex items-center justify-between mt-5 pt-4"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <button
                  onClick={dismiss}
                  className="text-xs transition-colors"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                >
                  Skip tour
                </button>
                <div className="flex gap-2">
                  {step > 0 && (
                    <button
                      onClick={prev}
                      className="text-sm px-4 py-2 rounded-xl font-medium"
                      style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)", background: "transparent" }}
                    >
                      ← Back
                    </button>
                  )}
                  <button
                    onClick={next}
                    className="text-sm px-5 py-2 rounded-xl font-bold active:scale-95 transition-transform"
                    style={{ background: "#f7a600", color: "#000" }}
                  >
                    {step === STEPS.length - 1 ? "Start trading!" : "Next →"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
