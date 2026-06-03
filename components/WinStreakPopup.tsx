"use client";

import { motion } from "framer-motion";

export default function WinStreakPopup({ onSwitchToReal, onDismiss }: { onSwitchToReal: () => void; onDismiss: () => void }) {
  return (
    <>
      <motion.div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onDismiss}
      />
      <motion.div
        className="fixed z-50 inset-x-4 bottom-6 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[360px] card p-6 shadow-2xl"
        initial={{ opacity: 0, scale: 0.88, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ type: "spring", stiffness: 340, damping: 26, mass: 0.8 }}
      >
        <button onClick={onDismiss} className="absolute top-3 right-3 text-muted hover:text-white text-lg leading-none">✕</button>
        <div className="text-3xl mb-3">🔥</div>
        <h2 className="text-lg font-bold tracking-tight mb-1">3 wins in a row!</h2>
        <p className="text-sm text-muted mb-5 leading-relaxed">
          You're reading the market well. Switch to a <span className="text-up font-semibold">Real account</span> and turn your streak into real profits.
        </p>
        <button onClick={onSwitchToReal} className="w-full py-2.5 rounded-lg bg-up text-black font-bold text-sm hover:opacity-90 transition-opacity mb-2">
          Switch to Real account
        </button>
        <button onClick={onDismiss} className="w-full py-2 text-xs text-muted hover:text-white transition-colors">
          Keep practising on Demo
        </button>
      </motion.div>
    </>
  );
}
