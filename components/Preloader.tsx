"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, type Transition } from "framer-motion";

// Resets on every hard reload (module re-evaluated).
// Stays true across client-side navigation so it only shows once per page load.
let _shownThisLoad = false;

const GREEN_CLIP = "polygon(0% 0%, 54% 0%, 46% 100%, 0% 100%)";
const BLUE_CLIP  = "polygon(54% 0%, 100% 0%, 100% 100%, 46% 100%)";

const pieceSpring: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 22,
  mass: 1,
};

const LETTERS = "SKYVULT".split("");

export default function Preloader() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (_shownThisLoad) return;
    _shownThisLoad = true;
    setShow(true);
    // No cleanup — let the timer fire even through Strict Mode remounts.
    setTimeout(() => setShow(false), 3000);
  }, []);

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          key="preloader"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.55, ease: [0.4, 0, 1, 1] } }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#1a1f29",
            gap: 0,
          }}
        >
          {/* ── Logo pieces ── */}
          <motion.div style={{ position: "relative", width: 140, height: 140 }}>
            {/* Glow that blooms when pieces lock */}
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0, 0.35, 0], scale: [0.6, 1.4, 1.8] }}
              transition={{ delay: 0.75, duration: 0.7, ease: "easeOut" }}
              style={{
                position: "absolute",
                inset: -20,
                borderRadius: "50%",
                background: "radial-gradient(circle, #2aba72 0%, #1a9fd4 50%, transparent 70%)",
                pointerEvents: "none",
              }}
            />

            {/* Green piece — lower-left → centre */}
            <motion.img
              src="/SkyVult logo.png"
              alt=""
              draggable={false}
              initial={{ x: -60, y: 60, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              transition={{ ...pieceSpring, delay: 0.1, opacity: { duration: 0.01, delay: 0.1 } }}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                clipPath: GREEN_CLIP,
                userSelect: "none",
              }}
            />

            {/* Blue piece — upper-right → centre */}
            <motion.img
              src="/SkyVult logo.png"
              alt=""
              draggable={false}
              initial={{ x: 60, y: -60, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              transition={{ ...pieceSpring, delay: 0.1, opacity: { duration: 0.01, delay: 0.1 } }}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                clipPath: BLUE_CLIP,
                userSelect: "none",
              }}
            />

            {/* Lock-in bounce */}
            <motion.div
              initial={{ scale: 1 }}
              animate={{ scale: [1, 1.08, 0.96, 1] }}
              transition={{ delay: 0.72, duration: 0.4, ease: "easeInOut" }}
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            />
          </motion.div>

          {/* ── SKYVULT — letters thrown from right ── */}
          <div style={{ display: "flex", marginTop: 28, overflow: "hidden", gap: 1 }}>
            {LETTERS.map((char, i) => (
              <motion.span
                key={i}
                initial={{ x: 60, opacity: 0, rotate: 15 }}
                animate={{ x: 0, opacity: 1, rotate: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 320,
                  damping: 20,
                  mass: 0.5,
                  delay: 0.95 + i * 0.075,
                }}
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  letterSpacing: "0.18em",
                  color: "#ffffff",
                  display: "inline-block",
                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                }}
              >
                {char}
              </motion.span>
            ))}
          </div>

          {/* ── Tagline ── */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.65, duration: 0.5, ease: "easeOut" }}
            style={{
              marginTop: 10,
              fontSize: 11,
              letterSpacing: "0.28em",
              color: "#4b5563",
              textTransform: "uppercase",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
            }}
          >
            Trade with confidence
          </motion.p>

          {/* ── Bottom progress bar ── */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 1.0, duration: 1.6, ease: [0.25, 1, 0.5, 1] }}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "linear-gradient(90deg, #2aba72, #1a9fd4)",
              transformOrigin: "left",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
