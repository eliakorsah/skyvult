"use client";

import { useEffect, useRef, useState } from "react";

export type Tick = {
  asset: string;
  price: number;
  timestamp: number;
  change: number;
  changePercent: number;
  candle?: { open: number; high: number; low: number; close: number; time: number };
};

export type Candle = {
  time: number;          // unix seconds, bucketed to 5s
  open: number;
  high: number;
  low:  number;
  close: number;
};

export type ServerMessage =
  | { type: "snapshot"; asset: string; ticks: Tick[] }
  | { type: "price"; tick: Tick }
  | { type: "trade-result"; tradeId: string; status: "WON" | "LOST" | "DRAW"; payout: number; exitPrice: number }
  | { type: "error"; error: string };

type Options = {
  /** Initial token. The socket also reads the freshest token from localStorage on each reconnect. */
  token?: string | null;
  onMessage?: (msg: ServerMessage) => void;
};

function resolveWsUrl(): string {
  // Allow override via env (e.g. wss://api.skyvult.app)
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl) return envUrl;
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const scheme = isHttps ? "wss" : "ws";
  const host = window.location.hostname;
  const port = process.env.NEXT_PUBLIC_WS_PORT || "3001";
  return `${scheme}://${host}:${port}`;
}

export function useSocket(opts: Options = {}) {
  const { onMessage } = opts;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let alive = true;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!alive) return;
      // Always read the freshest token at connect time (handles refresh)
      const token = typeof window !== "undefined"
        ? localStorage.getItem("skyvult_access")
        : null;
      const base = resolveWsUrl();
      const fullUrl = token ? `${base}?token=${encodeURIComponent(token)}` : base;

      let ws: WebSocket;
      try {
        ws = new WebSocket(fullUrl);
      } catch {
        // Construction can throw on malformed URL — schedule a retry
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) { ws.close(); return; }
        setConnected(true);
        retry = 0;
      };
      ws.onclose = (ev) => {
        setConnected(false);
        if (!alive) return;
        // 4001 = explicit auth rejection — don't loop fast retries
        if (ev.code === 4001) {
          retry = 6;
        }
        scheduleReconnect();
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMessage;
          handlerRef.current?.(msg);
        } catch {}
      };
    };

    const scheduleReconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      retry = Math.min(retry + 1, 6);
      const delay = Math.min(500 * 2 ** retry, 8000);
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  return { connected, ws: wsRef };
}
