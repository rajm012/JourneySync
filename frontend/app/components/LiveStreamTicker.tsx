"use client";
import { useSSE } from "@/lib/sse";
import { channel, eventLabel } from "@/lib/channels";
import { useEffect, useRef, useState } from "react";

/* The stream stays a log — it's the one place where raw arrival order is the
   point. But it's a ledger log: channel in its own colour, figures in mono,
   nothing below 13px, and an honest connection state. */

type Item = {
  id: string;
  channel: string;
  event_type: string;
  customer_id: string;
  confidence: number;
  at: string;
};

export function LiveStreamTicker() {
  const [items, setItems] = useState<Item[]>([]);
  const [rate, setRate] = useState(0);
  const stamps = useRef<number[]>([]);

  const { connected } = useSSE((msg) => {
    if (msg.channel !== "events.resolved") return;
    const e = msg.data;
    stamps.current.push(Date.now());
    setItems((prev) =>
      [
        {
          id: e.event_id,
          channel: e.channel,
          event_type: e.event_type,
          customer_id: e.customer_id,
          confidence: e.confidence,
          at: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 40),
    );
  });

  // Throughput over a rolling five seconds — the number that makes "real time"
  // a measurement rather than a claim.
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - 5000;
      stamps.current = stamps.current.filter((s) => s > cutoff);
      setRate(stamps.current.length / 5);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <div className="eyebrow">Pushed from the server</div>
          <h2 className="t-h2 mt-1.5">Events arriving</h2>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end gap-2 t-label">
            <span
              className={`inline-block w-2 h-2 rounded-full ${connected ? "animate-pulse" : ""}`}
              style={{ background: connected ? "var(--ok)" : "var(--flag)" }}
            />
            <span style={{ color: connected ? "var(--ink-2)" : "var(--flag)" }}>
              {connected ? "connected" : "reconnecting"}
            </span>
          </div>
          {connected && (
            <div className="figure t-label text-muted mt-0.5">{rate.toFixed(1)}/sec</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="max-h-64 overflow-y-auto scroll-quiet -mt-1">
          {items.length === 0 && (
            <p className="t-label text-muted py-3">
              {connected
                ? "Connected and idle. Run a scenario to see events land here as they resolve."
                : "No connection to the event stream. Check that the API is running."}
            </p>
          )}
          {items.map((i) => {
            const ch = channel(i.channel);
            return (
              <div
                key={i.id}
                className="flex items-baseline gap-2.5 py-1.5 border-b t-label min-w-0"
                style={{ borderColor: "var(--rule)" }}
              >
                <span className="figure text-muted shrink-0">{i.at.slice(11, 19)}</span>
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: ch.color }}
                  title={ch.label}
                />
                <span className="flex-1 truncate text-soft">{eventLabel(i.event_type)}</span>
                <span className="figure text-muted shrink-0">{i.customer_id}</span>
                <span
                  className="figure shrink-0 w-9 text-right"
                  style={{ color: (i.confidence ?? 0) >= 0.6 ? "var(--ok)" : "var(--flag-2)" }}
                >
                  {Math.round((i.confidence ?? 0) * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
