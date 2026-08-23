// Turning counts into money and minutes.
//
// Directors read P&L, not precision and recall. Every headline figure in the
// product therefore carries a financial consequence — but the arithmetic is
// shown, and the inputs are stated on screen, so nobody has to take a number
// on faith. Replace these with AmEx's own servicing figures and every number
// in the interface updates.

export const ASSUMPTIONS = {
  /** Fully-loaded cost of one assisted contact (call or branch). */
  costPerAssistedContact: 6.5,
  /** Minutes an agent saves when the customer's cross-channel history is already on screen. */
  minutesSavedPerInformedContact: 1.8,
  /** Loaded agent cost per minute. */
  agentCostPerMinute: 0.92,
  /** Annual contribution margin of one retained card member. */
  annualMarginPerRetainedCustomer: 480,
  /** Share of acted-on churn signals that convert into a save. */
  churnSaveRate: 0.18,
} as const;

export const ASSUMPTION_NOTES: { label: string; value: string }[] = [
  { label: "Cost per assisted contact", value: `$${ASSUMPTIONS.costPerAssistedContact.toFixed(2)}` },
  { label: "Handle time saved with full context", value: `${ASSUMPTIONS.minutesSavedPerInformedContact} min` },
  { label: "Loaded agent cost", value: `$${ASSUMPTIONS.agentCostPerMinute.toFixed(2)}/min` },
  { label: "Annual margin per retained member", value: `$${ASSUMPTIONS.annualMarginPerRetainedCustomer}` },
  { label: "Churn signals converted to a save", value: `${Math.round(ASSUMPTIONS.churnSaveRate * 100)}%` },
];

/** Compact currency — $1.2M, $84k, $650. Boardroom reading, not accounting. */
export function usd(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `$${Math.round(v / 1000)}k`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toLocaleString()}`;
}

/**
 * Value of the repeat contacts JourneySync makes avoidable. A repeat contact is
 * a customer telling the same story twice; with a stitched timeline the second
 * telling is either shorter or unnecessary.
 */
export function repeatContactValue(repeatCustomers: number) {
  const perMonth = repeatCustomers * ASSUMPTIONS.costPerAssistedContact;
  return { perMonth, perYear: perMonth * 12 };
}

/** Handle-time value across a volume of assisted contacts. */
export function handleTimeValue(assistedContacts: number) {
  const minutes = assistedContacts * ASSUMPTIONS.minutesSavedPerInformedContact;
  return { minutes, perMonth: minutes * ASSUMPTIONS.agentCostPerMinute };
}

/** Value of churn signals surfaced early enough to act on. */
export function churnSaveValue(openSignals: number) {
  const saves = openSignals * ASSUMPTIONS.churnSaveRate;
  return { saves, perYear: saves * ASSUMPTIONS.annualMarginPerRetainedCustomer };
}
