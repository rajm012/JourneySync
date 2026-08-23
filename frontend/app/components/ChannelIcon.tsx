// Real icons. The old unicode glyphs (◉ ▣ ☎ ⌂ ✉ ✦ ★) rendered differently on
// every OS and read as placeholder art — a drawn set is one line-weight, one
// grid, and looks the same on the presenter's laptop and the room projector.

type Props = { channel: string; className?: string };

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.35,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ channel }: { channel: string }) {
  switch (channel) {
    case "web":
      return (
        <g {...STROKE}>
          <rect x="1.9" y="3.2" width="12.2" height="9.6" rx="1.1" />
          <path d="M1.9 6.3h12.2" />
          <path d="M4 4.75h.01M5.9 4.75h.01" />
        </g>
      );
    case "mobile_app":
      return (
        <g {...STROKE}>
          <rect x="4.4" y="1.7" width="7.2" height="12.6" rx="1.4" />
          <path d="M6.9 12.35h2.2" />
        </g>
      );
    case "call_center":
      return (
        <g {...STROKE}>
          <path d="M3.3 9.4V8.2a4.7 4.7 0 0 1 9.4 0v1.2" />
          <rect x="1.85" y="9.2" width="2.5" height="3.7" rx="1.1" />
          <rect x="11.65" y="9.2" width="2.5" height="3.7" rx="1.1" />
          <path d="M12.9 12.9v.35a1.5 1.5 0 0 1-1.5 1.5H8.7" />
        </g>
      );
    case "branch":
      return (
        <g {...STROKE}>
          <path d="M1.7 6.35 8 2.3l6.3 4.05" />
          <path d="M3.7 7.5v5M6.55 7.5v5M9.45 7.5v5M12.3 7.5v5" />
          <path d="M1.9 13.5h12.2" />
        </g>
      );
    case "email":
      return (
        <g {...STROKE}>
          <rect x="1.7" y="3.9" width="12.6" height="8.2" rx="1" />
          <path d="m1.9 4.4 6.1 4.3 6.1-4.3" />
        </g>
      );
    case "sms":
      return (
        <g {...STROKE}>
          <path d="M2.1 3.4h11.8v7.3H8.3L5.1 13v-2.3H2.1z" />
        </g>
      );
    default:
      return (
        <g {...STROKE}>
          <circle cx="8" cy="8" r="4.2" />
        </g>
      );
  }
}

export function ChannelIcon({ channel, className = "w-4 h-4" }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <Glyph channel={channel} />
    </svg>
  );
}
