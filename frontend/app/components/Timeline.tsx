"use client";

import { TimelineEvent } from "@/lib/api";
import { channel, eventLabel } from "@/lib/channels";
import { ChannelIcon } from "./ChannelIcon";
import { useEffect, useState } from "react";

/* A statement, not a stack of cards. One column, newest first, each entry a
   ruled row: time in the left figure column, the channel drawn in its own
   colour, the match confidence right-aligned so the column reads down. */

function eventDetail(e: TimelineEvent) {
  const p = e.payload || {};
  const v =
    p.product_name || p.url || p.queue || p.reason || p.transaction_type || p.transcript || p.text;
  return v ? String(v) : null;
}

function LocalTime({ iso }: { iso: string }) {
  // Node in Docker renders UTC, the browser renders local — the ISO slice is
  // identical on both passes, then the localized value lands after mount.
  const [text, setText] = useState(iso.slice(11, 16));
  useEffect(() => {
    setText(new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }, [iso]);
  return <>{text}</>;
}

function DayLabel({ date }: { date: string }) {
  const [text, setText] = useState(date);
  useEffect(() => {
    setText(
      new Date(`${date}T12:00:00Z`).toLocaleDateString([], {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    );
  }, [date]);
  return <>{text}</>;
}

export function Timeline({
  events,
  compact = false,
}: {
  events: TimelineEvent[];
  compact?: boolean;
}) {
  if (!events?.length) {
    return <p className="t-body text-muted py-8">No journey events yet.</p>;
  }

  const sorted = [...events].sort((a, b) => +new Date(b.occurred_at) - +new Date(a.occurred_at));
  const groups = sorted.reduce<Record<string, TimelineEvent[]>>((all, event) => {
    const key = new Date(event.occurred_at).toISOString().slice(0, 10);
    (all[key] ||= []).push(event);
    return all;
  }, {});

  return (
    <div className="space-y-7">
      {Object.entries(groups).map(([date, dayEvents]) => (
        <section key={date}>
          <div
            className="flex items-baseline justify-between gap-4 pb-1.5 border-b"
            style={{ borderColor: "var(--rule-strong)" }}
          >
            <h3 className="eyebrow" style={{ color: "var(--ink-2)" }}>
              <DayLabel date={date} />
            </h3>
            <span className="t-label text-muted figure">
              {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
            </span>
          </div>

          <ol>
            {dayEvents.map((e, i) => {
              const ch = channel(e.channel);
              const detail = eventDetail(e);
              return (
                <li
                  key={e.event_id || i}
                  className="grid gap-x-3 py-2.5 border-b hover-surface transition-colors"
                  style={{
                    borderColor: "var(--rule)",
                    gridTemplateColumns: "3.25rem 1.25rem minmax(0,1fr) auto",
                  }}
                >
                  <span className="figure t-label text-muted pt-0.5 tabular-nums">
                    <LocalTime iso={e.occurred_at} />
                  </span>

                  <span className="pt-0.5" style={{ color: ch.color }} title={ch.label}>
                    <ChannelIcon channel={e.channel} className="w-4 h-4" />
                  </span>

                  <div className="min-w-0">
                    <div className="t-body font-semibold leading-snug">
                      {eventLabel(e.event_type)}
                      <span className="font-normal text-muted"> · {ch.label}</span>
                    </div>
                    {detail && (
                      <p className={`t-label text-soft mt-0.5 ${compact ? "truncate" : "line-clamp-2"}`}>
                        {detail}
                      </p>
                    )}
                    {!compact && (
                      <p className="t-label text-muted mt-1">
                        {e.match_method?.replace(/_/g, " ")} · {e.match_status} ·{" "}
                        <span className="figure">{e.event_id}</span>
                      </p>
                    )}
                  </div>

                  <span
                    className="figure t-label pt-0.5 text-right"
                    style={{
                      color: (e.confidence ?? 0) >= 0.6 ? "var(--ink-2)" : "var(--flag-2)",
                    }}
                    title={`Match confidence ${Math.round((e.confidence || 0) * 100)}%`}
                  >
                    {Math.round((e.confidence || 0) * 100)}%
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
