"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { motion } from "framer-motion";

type Message = {
  id: string;
  body: string;
  status: "OPEN" | "READ" | "RESOLVED";
  createdAt: string;
};

const STATUS_LABEL: Record<Message["status"], { label: string; cls: string }> = {
  OPEN:     { label: "Sent",     cls: "bg-accent/15 text-accent border-accent/30" },
  READ:     { label: "Seen",     cls: "bg-up/15 text-up border-up/30" },
  RESOLVED: { label: "Resolved", cls: "bg-up/15 text-up border-up/30" },
};

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SupportPage() {
  const [body, setBody] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentOk, setSentOk] = useState(false);

  async function load() {
    try {
      const d = await api<{ messages: Message[] }>("/api/messages");
      setMessages(d.messages);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSentOk(false);
    if (body.trim().length < 2) { setError("Please write a message first."); return; }

    try {
      setSending(true);
      await api("/api/messages", { method: "POST", body: JSON.stringify({ body: body.trim() }) });
      setBody("");
      setSentOk(true);
      load();
    } catch (err: any) {
      setError(err?.message ?? "Could not send your message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-[100dvh] px-5 pt-8 pb-16 flex justify-center">
      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/25 to-accent/5 ring-1 ring-accent/30 flex items-center justify-center text-accent mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}
                d="M8 10h8M8 14h5M21 12a8 8 0 01-11.6 7.1L4 20l1-4.3A8 8 0 1121 12z" />
            </svg>
          </div>
          <h1 className="text-[1.6rem] leading-tight font-bold">Message Us</h1>
          <p className="text-muted text-sm mt-2 max-w-xs">
            Questions, deposits, withdrawals or anything else — send us a message and we'll get back to you.
          </p>
        </div>

        {/* Compose */}
        <form onSubmit={send} className="space-y-3">
          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); setSentOk(false); }}
            placeholder="Type your message…"
            rows={4}
            maxLength={2000}
            className="input w-full resize-none text-base"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{body.length}/2000</span>
            {sentOk && <span className="text-xs text-up font-medium">✓ Message sent</span>}
          </div>

          {error && (
            <div className="bg-down/10 border border-down/30 rounded-xl px-4 py-3 text-down text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={sending}
            className="btn btn-primary w-full py-3.5 text-base flex items-center justify-center gap-2"
          >
            {sending && <span className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />}
            {sending ? "Sending…" : "Send Message"}
          </button>
        </form>

        {/* History */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Your messages</h2>
          {loading ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-muted text-sm">No messages yet.</p>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const s = STATUS_LABEL[m.status];
                return (
                  <div key={m.id} className="card p-4">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className={`text-[10px] font-semibold border rounded-full px-2 py-px ${s.cls}`}>{s.label}</span>
                      <span className="text-[11px] text-muted">{ago(m.createdAt)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
