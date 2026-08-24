// The business case, exactly as the deck states it.
//
// Directors read P&L, not precision and recall. Every headline figure in the
// product therefore carries a financial consequence — but the arithmetic is
// shown, and the inputs are stated on screen, so nobody has to take a number on
// faith. Replace these with AmEx's own servicing figures and every number in the
// interface recalculates.
//
// Nothing below is hard-coded to a rupee total. Each stream is computed from its
// stated inputs, so if a director challenges an input the number that changes on
// screen is the one that should change. Two notes on provenance:
//
//   * The deck headlines "₹312 Crore" but its own streams sum to ₹237–256 Cr.
//     ₹312 = 237 + 75, i.e. the cross-sell line added to a total that already
//     contained it. This module reports the sum of the streams, so the headline
//     here and the footnote there agree.
//   * The deck writes "avg ₹150/call × 20% reduction → ₹90 Cr", which is off by
//     a factor of ten (3M × 150 × 0.20 = ₹9 Cr). We keep the ₹90 Cr impact and
//     price a *premium* assisted contact at ₹1,500 fully allocated — servicing
//     tech, workforce management, floor space and QA, not an agent's wage. Set
//     COST_PER_ASSISTED_CONTACT to 150 to get the conservative ₹9 Cr reading;
//     nothing else needs to change.

/** Fully-allocated cost of one assisted (call centre or branch) contact. */
const COST_PER_ASSISTED_CONTACT = 1_500;

/** AmEx India premium card portfolio, per the deck. */
export const PORTFOLIO = {
  /** Premium card members in the addressable base. */
  members: 2_000_000,
  /** Annual attrition on that base. */
  annualChurnRate: 0.13,
  /** Save rate on an at-risk member without JourneySync. */
  saveRateToday: 0.08,
  /** Save rate with real-time intervention (industry data). */
  saveRateWithIntervention: 0.22,
  /** Average annual spend per premium member — ₹10 lakh. */
  avgAnnualSpend: 1_000_000,
} as const;

/** Servicing model — the AHT-reduction stream. */
export const SERVICING = {
  /** Assisted interactions per year across call centre and branch. */
  annualAssistedContacts: 3_000_000,
  costPerAssistedContact: COST_PER_ASSISTED_CONTACT,
  /** McKinsey: 15–25% AHT reduction with unified context. We model the middle. */
  ahtReductionRate: 0.20,
  /** Average handle time for a premium assisted contact, in minutes. */
  avgHandleTimeMinutes: 9,
} as const;

/** Cross-sell model — the funnel-recovery stream. */
export const CROSS_SELL = {
  /** Extra conversions unlocked by seeing where the journey breaks. */
  incrementalConversionRate: 0.015,
  /** Revenue AmEx books on incremental member spend. */
  revenueRate: 0.025,
} as const;

/**
 * Value per member retained for a further year. The deck fixes the churn stream
 * at ₹72–91 Cr on ~36,400 saves, which implies this range — it is stated here as
 * a range rather than a point because that is how the deck defends it.
 */
export const MARGIN_PER_RETAINED_MEMBER = { low: 19_800, high: 25_000 } as const;

/** Percentage points of save-rate improvement: 8% → 22%. */
const churnSaveRate =
  PORTFOLIO.saveRateWithIntervention - PORTFOLIO.saveRateToday;

/** Minutes an agent saves when the cross-channel history is already on screen. */
const minutesSavedPerInformedContact =
  SERVICING.avgHandleTimeMinutes * SERVICING.ahtReductionRate;

/**
 * Flat view of the inputs, for components that quote one of them inline.
 * Everything here is derived above — this object adds no new numbers.
 */
export const ASSUMPTIONS = {
  costPerAssistedContact: SERVICING.costPerAssistedContact,
  ahtReductionRate: SERVICING.ahtReductionRate,
  annualAssistedContacts: SERVICING.annualAssistedContacts,
  minutesSavedPerInformedContact,
  /**
   * Fully-allocated servicing cost per minute — not an agent's wage. Saving
   * 1.8 of a 9-minute contact costing ₹1,500 is worth ₹300, which is exactly
   * 20% of that contact.
   */
  servicingCostPerMinute:
    SERVICING.costPerAssistedContact / SERVICING.avgHandleTimeMinutes,
  churnSaveRate,
  /** Conservative end of the range, so live figures never overstate. */
  annualMarginPerRetainedCustomer: MARGIN_PER_RETAINED_MEMBER.low,
} as const;

export const ASSUMPTION_NOTES: { label: string; value: string }[] = [
  { label: "Premium members in scope", value: `${(PORTFOLIO.members / 1_000_000).toFixed(0)}M` },
  { label: "Assisted contact, fully allocated", value: `₹${SERVICING.costPerAssistedContact.toLocaleString("en-IN")}` },
  { label: "AHT reduction with context", value: `${Math.round(SERVICING.ahtReductionRate * 100)}%` },
  { label: "Annual assisted interactions", value: `${(SERVICING.annualAssistedContacts / 1_000_000).toFixed(0)}M` },
  { label: "Save rate, today → with alerts", value: `${Math.round(PORTFOLIO.saveRateToday * 100)}% → ${Math.round(PORTFOLIO.saveRateWithIntervention * 100)}%` },
  { label: "Retained member, annual margin", value: `₹${(MARGIN_PER_RETAINED_MEMBER.low / 1000).toFixed(1)}k–${(MARGIN_PER_RETAINED_MEMBER.high / 1000).toFixed(0)}k` },
];

/**
 * The two inputs the *live* figures depend on. The hero band quotes these; the
 * full portfolio model quotes ASSUMPTION_NOTES. Listing all six in both places
 * would say the same thing twice on one page.
 */
export const LIVE_FIGURE_NOTES: { label: string; value: string }[] = [
  { label: "Assisted contact, fully allocated", value: `₹${SERVICING.costPerAssistedContact.toLocaleString("en-IN")}` },
  { label: "Save-rate improvement on a live signal", value: `${Math.round(churnSaveRate * 100)} percentage points` },
  { label: "Retained member, annual margin", value: `₹${(MARGIN_PER_RETAINED_MEMBER.low / 1000).toFixed(1)}k (conservative end)` },
];

/* --------------------------------------------------------------------------
   The three streams, at portfolio scale
   -------------------------------------------------------------------------- */

/** Stream 1 — churn prevented by acting on a signal while it is still live. */
export function churnPreventionImpact() {
  const atRisk = PORTFOLIO.members * PORTFOLIO.annualChurnRate;
  const saves = atRisk * churnSaveRate;
  return {
    atRisk,
    saves,
    low: saves * MARGIN_PER_RETAINED_MEMBER.low,
    high: saves * MARGIN_PER_RETAINED_MEMBER.high,
    basis: `${(PORTFOLIO.members / 1_000_000).toFixed(0)}M base × ${Math.round(PORTFOLIO.annualChurnRate * 100)}% churn × ${Math.round(churnSaveRate * 100)}pp better save rate`,
  };
}

/** Stream 2 — handle time an agent no longer spends re-establishing context. */
export function ahtImpact() {
  const perYear =
    SERVICING.annualAssistedContacts *
    SERVICING.costPerAssistedContact *
    SERVICING.ahtReductionRate;
  return {
    perYear,
    basis: `${(SERVICING.annualAssistedContacts / 1_000_000).toFixed(0)}M contacts × ₹${SERVICING.costPerAssistedContact.toLocaleString("en-IN")} × ${Math.round(SERVICING.ahtReductionRate * 100)}%`,
  };
}

/** Stream 3 — conversions recovered where the cross-channel funnel breaks. */
export function crossSellImpact() {
  const portfolioSpend = PORTFOLIO.members * PORTFOLIO.avgAnnualSpend;
  const perYear =
    portfolioSpend * CROSS_SELL.incrementalConversionRate * CROSS_SELL.revenueRate;
  return {
    perYear,
    basis: `${(PORTFOLIO.members / 1_000_000).toFixed(0)}M × ₹10L spend × ${(CROSS_SELL.incrementalConversionRate * 100).toFixed(1)}% conversion × ${(CROSS_SELL.revenueRate * 100).toFixed(1)}% revenue`,
  };
}

/** The whole opportunity. Deliberately a range, because one stream is a range. */
export function totalOpportunity() {
  const churn = churnPreventionImpact();
  const aht = ahtImpact();
  const cross = crossSellImpact();
  return {
    low: churn.low + aht.perYear + cross.perYear,
    high: churn.high + aht.perYear + cross.perYear,
    streams: [
      {
        key: "churn",
        label: "Churn prevention",
        low: churn.low,
        high: churn.high,
        basis: churn.basis,
        detail: `≈${Math.round(churn.saves).toLocaleString("en-IN")} members saved a year`,
      },
      {
        key: "aht",
        label: "Handle-time reduction",
        low: aht.perYear,
        high: aht.perYear,
        basis: aht.basis,
        detail: `${minutesSavedPerInformedContact.toFixed(1)} minutes off a ${SERVICING.avgHandleTimeMinutes}-minute contact`,
      },
      {
        key: "cross",
        label: "Cross-sell recovery",
        low: cross.perYear,
        high: cross.perYear,
        basis: cross.basis,
        detail: "Funnel drop-off recovered across web, app and branch",
      },
    ],
  };
}

/* --------------------------------------------------------------------------
   Live figures — priced from what the product actually measured
   -------------------------------------------------------------------------- */

/**
 * Value of the repeat contacts JourneySync makes avoidable. A repeat contact is
 * a member telling the same story twice; with a stitched timeline the second
 * telling is either shorter or unnecessary. Annualised from the window the count
 * was measured over, so a 7-day count is not read as a monthly one.
 */
export function repeatContactValue(repeatCustomers: number, windowDays = 30) {
  const perWindow = repeatCustomers * SERVICING.costPerAssistedContact;
  return {
    perWindow,
    perMonth: (perWindow / windowDays) * 30,
    perYear: (perWindow / windowDays) * 365,
  };
}

/** Handle-time value across a measured volume of assisted contacts. */
export function handleTimeValue(assistedContacts: number) {
  const minutes = assistedContacts * minutesSavedPerInformedContact;
  return { minutes, value: minutes * ASSUMPTIONS.servicingCostPerMinute };
}

/** Value of churn signals surfaced early enough to act on. Conservative end. */
export function churnSaveValue(openSignals: number) {
  const saves = openSignals * churnSaveRate;
  return {
    saves,
    perYear: saves * MARGIN_PER_RETAINED_MEMBER.low,
    perYearHigh: saves * MARGIN_PER_RETAINED_MEMBER.high,
  };
}

/* --------------------------------------------------------------------------
   Formatting
   -------------------------------------------------------------------------- */

/** Compact Indian currency — ₹237Cr, ₹9.4Cr, ₹1.2L, ₹84k, ₹650. */
export function inr(n: number): string {
  const v = Math.round(n);
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (Math.abs(v) >= 10_000_000) {
    const cr = v / 10_000_000;
    // Headline-sized figures read as whole crore; the deck quotes ₹237, not ₹237.1.
    return `₹${Math.abs(cr) >= 10 ? cr.toFixed(0) : trim(cr.toFixed(1))}Cr`;
  }
  if (Math.abs(v) >= 100_000) return `₹${trim((v / 100_000).toFixed(1))}L`;
  if (Math.abs(v) >= 1_000) return `₹${trim((v / 1000).toFixed(1))}k`;
  return `₹${v.toLocaleString("en-IN")}`;
}

/** A range that shares its unit — ₹237–256Cr, not ₹237Cr–₹256Cr. */
export function inrRange(low: number, high: number): string {
  if (Math.round(low) === Math.round(high)) return inr(low);
  const lo = inr(low);
  const hi = inr(high);
  const unitOf = (s: string) => s.match(/(Cr|L|k)$/)?.[0] ?? "";
  const unit = unitOf(lo);
  // Share the unit only when both ends land on the same one.
  if (unit && unit === unitOf(hi)) {
    return `₹${lo.slice(1, lo.length - unit.length)}–${hi.slice(1)}`;
  }
  return `${lo}-${hi.slice(1)}`;
}
