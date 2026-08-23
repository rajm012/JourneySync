"use client";

import { useCallback, useEffect, useState } from "react";

/* Presentation mode. Every size in the product is expressed in rem, so moving
   the root font size once scales the entire interface — type, spacing, rules,
   controls — for a room where the nearest viewer is ten feet from the screen.
   Press P, or use the control in the header. */

const KEY = "js-present";

export function PresentationMode() {
  const [on, setOn] = useState(false);

  const apply = useCallback((next: boolean) => {
    document.documentElement.classList.toggle("present", next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* private mode — the toggle still works for this session */
    }
    setOn(next);
  }, []);

  useEffect(() => {
    let initial = false;
    try {
      initial = window.localStorage.getItem(KEY) === "1";
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle("present", initial);
    setOn(initial);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "p" && e.key !== "P") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd-P to the print dialog
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      apply(!document.documentElement.classList.contains("present"));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply]);

  return (
    <button
      type="button"
      onClick={() => apply(!on)}
      className="btn-ghost inline-flex items-center justify-center"
      style={{ width: 32, height: 32, padding: 0 }}
      aria-pressed={on}
      aria-label={on ? "Use normal screen size" : "Use larger room size"}
      title="Scale the whole interface for a projector — shortcut: P"
    >
      {on ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" style={{ display: "block" }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 3v5.5H3M15.5 3v5.5H21M8.5 21v-5.5H3M15.5 21v-5.5H21" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" style={{ display: "block" }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 3H3v5.5M15.5 3H21v5.5M8.5 21H3v-5.5M15.5 21H21v-5.5" />
        </svg>
      )}
    </button>
  );
}
