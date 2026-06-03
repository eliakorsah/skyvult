"use client";

import { AnimatePresence, motion } from "framer-motion";

export type ResultData = {
  status: "WON" | "LOST" | "DRAW";
  payout: number;
  exitPrice: number;
};

export default function ResultPopup({ result, onClose }: { result: ResultData | null; onClose: () => void }) {
  const color = result?.status === "WON" ? "text-up" : result?.status === "LOST" ? "text-down" : "text-accent";
  const label = result?.status === "WON" ? "You Won!" : result?.status === "LOST" ? "Lost" : "Draw — refunded";
  const emoji = result?.status === "WON" ? "🎉" : result?.status === "LOST" ? "📉" : "↩️";

  return (
    <AnimatePresence>
      {result && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-50 grid place-items-center px-4"
            initial={{ backgroundColor: "rgba(0,0,0,0)" }}
            animate={{ backgroundColor: "rgba(0,0,0,0.7)" }}
            exit={{ backgroundColor: "rgba(0,0,0,0)" }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          >
            {/* Card */}
            <motion.div
              key="card"
              className="card p-6 sm:p-8 text-center w-full max-w-xs sm:max-w-sm"
              initial={{ opacity: 0, scale: 0.88, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 12 }}
              transition={{ type: "spring", stiffness: 340, damping: 26, mass: 0.8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-4xl mb-2">{emoji}</div>
              <div className={`text-2xl sm:text-3xl font-bold ${color}`}>{label}</div>
              {result.status !== "LOST" && (
                <div className="mt-3 font-mono text-xl sm:text-2xl text-white">
                  +₵{result.payout.toFixed(2)}
                </div>
              )}
              <div className="mt-2 text-muted text-sm">Exit price: {result.exitPrice}</div>
              <button onClick={onClose} className="btn btn-secondary mt-6 w-full py-3">Close</button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
