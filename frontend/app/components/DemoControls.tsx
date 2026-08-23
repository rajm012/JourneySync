"use client";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "";

/* Demo controls, in the interface's own voice. "Run hero scenario" is the
   team's word for it; "Run Asha's journey" is what it does. */

export function DemoControls({ onBand = false }: { onBand?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const primary = onBand ? "btn-band" : "btn";
  const ghost = onBand ? "btn-band" : "btn-ghost";

  async function fire(path: string, key: string, working: string, reloadAfterMs?: number) {
    setBusy(key);
    setNote(working);
    try {
      const r = await fetch(`${API}${path}`, { method: "POST" });
      if (!r.ok) {
        setNote(`The API returned ${r.status}. Check that the backend is running on port 8000.`);
        setBusy(null);
        return;
      }
      if (reloadAfterMs) {
        setNote("Stitching complete — refreshing.");
        setTimeout(() => window.location.reload(), reloadAfterMs);
        return;
      }
      setNote("Done.");
    } catch {
      setNote("Couldn't reach the API on port 8000.");
    } finally {
      if (!reloadAfterMs) {
        setTimeout(() => {
          setBusy(null);
          setNote(null);
        }, 2500);
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <button
        onClick={() => fire("/api/demo/run", "demo", "Seeding Asha and stitching her journey…", 10000)}
        disabled={busy !== null}
        className={`${primary} t-label`}
      >
        {busy === "demo" ? "Running…" : "Run Asha's journey"}
      </button>
      <button
        onClick={() =>
          fire("/api/demo/burst?n=10000&duration=30", "burst", "Pushing 10,000 events over 30 seconds…")
        }
        disabled={busy !== null}
        className={`${ghost} t-label`}
      >
        {busy === "burst" ? "Pushing…" : "Load test · 10,000 events"}
      </button>
      <button
        onClick={() => fire("/api/demo/alerts", "alerts", "Evaluating risk rules…")}
        disabled={busy !== null}
        className={`${ghost} t-label`}
      >
        {busy === "alerts" ? "Evaluating…" : "Trigger risk signals"}
      </button>
      <button
        onClick={() => {
          if (
            window.confirm(
              "Clear all members, journeys and alerts, then reload the clean 1,000-member catalog?",
            )
          ) {
            fire("/api/demo/reset", "reset", "Reloading the clean catalog…", 4000);
          }
        }}
        disabled={busy !== null}
        className={`${ghost} t-label`}
        title="Clears drift from repeated runs so the member count matches the one-pager"
      >
        {busy === "reset" ? "Resetting…" : "Reset demo data"}
      </button>
      {note && (
        <span className="t-label" style={{ color: onBand ? "var(--ink-band-2)" : "var(--ink-3)" }}>
          {note}
        </span>
      )}
    </div>
  );
}
