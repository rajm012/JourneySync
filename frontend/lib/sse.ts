"use client";
import { useEffect, useRef, useState } from "react";

export type SSEPayload = { channel: string; data: any };

export function useSSE(onMessage?: (m: SSEPayload) => void) {
  const [connected, setConnected] = useState(false);
  // Keep the latest callback in a ref instead of the effect's dependency
  // array. Callers typically pass an inline function that's a new reference
  // every render (often triggered by onMessage itself calling setState), so
  // depending on it directly would tear down and reopen the EventSource on
  // every message — a reconnect storm under any real event volume.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    // Prefer direct backend URL from the browser so SSE isn't buffered by Next.
    const base = process.env.NEXT_PUBLIC_API_URL || "";
    const es = new EventSource(`${base}/api/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const payload: SSEPayload = JSON.parse(e.data);
        onMessageRef.current?.(payload);
      } catch {}
    };
    return () => { es.close(); setConnected(false); };
  }, []);
  return { connected };
}
