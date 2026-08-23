// One definition of a channel, used by the spine, the timeline, the ticker and
// every table. Channels sit on a single cool ramp ordered dark → light, so the
// four of them read as one family rather than a rainbow of Tailwind defaults.

export const CHANNEL_ORDER = ["web", "mobile_app", "call_center", "branch"] as const;
export type ChannelKey = (typeof CHANNEL_ORDER)[number];

export type ChannelDef = {
  /** Full label, used in headings and legends. */
  label: string;
  /** Lane label — short enough for the spine gutter. */
  short: string;
  /** CSS custom property holding the mark colour. Fills only, never text. */
  color: string;
  /** Assisted channels cost money per contact; digital ones don't. */
  assisted: boolean;
};

export const CHANNELS: Record<string, ChannelDef> = {
  web: { label: "Web", short: "WEB", color: "var(--ch-web)", assisted: false },
  mobile_app: { label: "Mobile app", short: "APP", color: "var(--ch-app)", assisted: false },
  call_center: { label: "Call center", short: "CALL", color: "var(--ch-call)", assisted: true },
  branch: { label: "Branch", short: "BRANCH", color: "var(--ch-branch)", assisted: true },
  email: { label: "Email", short: "EMAIL", color: "var(--ch-email)", assisted: false },
  sms: { label: "SMS", short: "SMS", color: "var(--ch-sms)", assisted: false },
};

const UNKNOWN: ChannelDef = {
  label: "Other",
  short: "OTHER",
  color: "var(--ch-none)",
  assisted: false,
};

export function channel(key: string | undefined | null): ChannelDef {
  if (!key) return UNKNOWN;
  return CHANNELS[key] ?? { ...UNKNOWN, label: key.replace(/_/g, " "), short: key.slice(0, 6).toUpperCase() };
}

/** Plain-English event names. The system's vocabulary, not the database's. */
export const EVENT_LABELS: Record<string, string> = {
  page_view: "Viewed a page",
  product_view: "Viewed a product",
  add_to_cart: "Added to cart",
  payment_attempt: "Attempted payment",
  payment_success: "Completed payment",
  payment_failed: "Payment failed",
  login_success: "Signed in",
  login_failed: "Sign-in failed",
  app_open: "Opened the app",
  call_initiated: "Started a support call",
  call_connected: "Connected with support",
  agent_handoff: "Transferred to an agent",
  transcript: "Call transcript captured",
  branch_visit: "Visited a branch",
  transaction: "Completed a transaction",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}
