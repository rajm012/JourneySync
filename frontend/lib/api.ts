// Typed API client
// Browser: NEXT_PUBLIC_API_URL (localhost:8000)
// Next server inside Docker: API_INTERNAL_URL (http://backend:8000)
const BASE =
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";

export type Customer = {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  loyalty_card: string | null;
  home_geo_lat: number | null;
  home_geo_lon: number | null;
  total_events?: number;
  channels_touched?: string[];
  first_seen?: string;
  last_seen?: string;
};

export type CustomersResponse = {
  items: Customer[]; count: number; total: number; limit: number; offset: number;
};

export type TimelineEvent = {
  event_id: string;
  channel: string;
  event_type: string;
  occurred_at: string;
  confidence: number;
  match_method: string;
  match_status: string;
  payload: Record<string, any>;
};

export type Timeline = Customer & {
  events: TimelineEvent[];
};

export type Alert = {
  id: string;
  customer_id: string;
  rule_id: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  body: string;
  suggested_action: string;
  status: string;
  created_at: string;
  acknowledged_at?: string;
};

export type Funnel = {
  window_hours: number;
  steps: { step: string; count: number; drop_off_pct: number | null }[];
};

export type Metrics = {
  totals: {
    customers: number;
    resolutions: number;
    uncertain: number;
    alerts: number;
    open_alerts: number;
  };
  latency: {
    samples: number;
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    max: number;
  };
  accuracy?: {
    precision: number;
    recall: number;
    scored?: number;
    true_positives?: number;
    customers_touched?: number;
    catalog_size?: number;
    measured_at?: string;
    source?: string;
  };
};

export type UnresolvedItem = {
  id: number;
  event_id: string;
  customer_id: string | null;
  customer_name: string | null;
  confidence: number;
  method: string;
  signals: Record<string, any>;
  match_status: "uncertain" | "unresolved" | "conflict" | string;
  decided_at: string | null;
};

export type UnresolvedResponse = {
  summary: {
    needing_review: number;
    by_status: Record<string, number>;
    by_method: Record<string, number>;
  };
  items: UnresolvedItem[];
  count: number;
};

export type RepeatContact = {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  total: number;
  by_channel: { channel: string; count: number; last_at?: string | null }[];
  last_contact_at: string | null;
  risk: "elevated" | "medium" | "high" | string;
};

export type RepeatContactsResponse = {
  days: number;
  min_contacts: number;
  items: RepeatContact[];
  count: number;
};

export type IdentityGraphIdentifier = { type: string; value: string };
export type IdentityGraphSignal = { type: string; value: string; last_seen: string | null };
export type IdentityGraphConflict = {
  event_id: string;
  method: string;
  detail: Record<string, any>;
  decided_at: string | null;
};

export type IdentityGraph = {
  customer: {
    customer_id: string;
    name: string | null;
    email: string | null;
    phone_e164: string | null;
    loyalty_card: string | null;
  };
  identifiers: IdentityGraphIdentifier[];
  signals: IdentityGraphSignal[];
  conflicts: IdentityGraphConflict[];
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export const api = {
  customers: (limit = 24, offset = 0, search = "") =>
    get<CustomersResponse>(`/api/customers?limit=${limit}&offset=${offset}&search=${encodeURIComponent(search)}`),
  customer: (id: string) => get<Customer>(`/api/customers/${id}`),
  timeline: (id: string) => get<Timeline>(`/api/customers/${id}/timeline?limit=200`),
  identityGraph: (id: string) => get<IdentityGraph>(`/api/customers/${id}/graph`),
  funnel: (window_hours = 24) => get<Funnel>(`/api/funnel?window_hours=${window_hours}`),
  alerts: (status = "open", customerId?: string) =>
    get<{ items: Alert[]; count: number }>(
      `/api/alerts?status=${status}&limit=50${customerId ? `&customer_id=${encodeURIComponent(customerId)}` : ""}`,
    ),
  ackAlert: async (id: string) => {
    const r = await fetch(`${BASE}/api/alerts/${id}/ack`, { method: "POST" });
    if (!r.ok) throw new Error(`ack ${id} → ${r.status}`);
    return r.json();
  },
  metrics: () => get<Metrics>("/api/metrics"),
  unresolved: (limit = 100) => get<UnresolvedResponse>(`/api/unresolved?limit=${limit}`),
  repeatContacts: (days = 7, min = 2) =>
    get<RepeatContactsResponse>(`/api/analytics/repeat-contacts?days=${days}&min=${min}&limit=100`),
};
