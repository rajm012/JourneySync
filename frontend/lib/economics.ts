// The business case — built on published figures, not on a target.
//
// Directors read P&L, not precision and recall. So every headline in this
// product carries a financial consequence. But an AmEx audience knows its own
// card count and its own servicing costs, so a number that cannot be traced to
// a source is worse than no number at all. Every input below is one of four
// kinds, and each one says which it is:
//
//   regulatory — RBI's published bank-wise card statistics. Not arguable.
//   reported   — American Express's own reported financials.
//   derived    — arithmetic on the two above, shown in full.
//   benchmark  — an industry figure or a stated allowance. Arguable, and the
//                one AmEx should overwrite with its own data first.
//
// The same table is served by the backend at GET /api/economics, so the claims
// on screen are machine-checkable against their sources. Keep the two in step:
// backend/app/api/economics.py holds the identical raw inputs.
//
// What changed from the deck, and why
// -----------------------------------
// The deck modelled 2,000,000 premium members spending ₹10 lakh a year, and
// priced an assisted contact at ₹1,500, for ₹237–256 Cr. Three of those four
// inputs do not survive contact with the published data:
//
//   * RBI puts American Express Banking Corporation at 1,300,853 credit cards
//     outstanding in June 2026 — 35% below the 2M in the deck.
//   * The same release puts AmEx India spend at ₹5,926.7 Cr in that month,
//     which is ₹5.47 lakh per card per year, not ₹10 lakh.
//   * ₹1,500 for a nine-minute contact is ₹167 a minute, or roughly ₹10,000 an
//     hour of agent time. That is not an Indian servicing cost. Built up from a
//     loaded seat instead, the honest figure is ₹139 — close to the ₹150 the
//     deck itself used before the ₹90 Cr line multiplied it by ten.
//
// The model is therefore smaller and the shape of it moved: the money is in
// retention and conversion, not in handle time, because Indian servicing is
// cheap. That is a better argument than the bigger number was, and it is the
// one the data supports.

/* --------------------------------------------------------------------------
   Raw inputs — the only numbers in this file that are typed in by hand
   -------------------------------------------------------------------------- */

/**
 * RBI, "ATM, Acceptance Infrastructure and Card Statistics for the Month of
 * June 2026" (provisional) — bank-wise, American Express Banking Corporation.
 * https://www.rbi.org.in/Scripts/ATMView.aspx?atmid=184
 *
 * AmEx India issues no debit cards and operates no ATMs, so credit cards are
 * the whole book. Values are as published: thousands of rupees, converted here
 * to rupees.
 */
export const RBI_JUN_2026 = {
  /** Credit cards outstanding at month end. */
  amexCardsOutstanding: 1_300_853,
  /** PoS + online + other credit-card payment value, in rupees. */
  amexMonthlySpend: 59_267_497 * 1_000,
  /** PoS + online + other credit-card payment transactions. */
  amexMonthlyTransactions: 5_871_438,
  /** AmEx PoS terminals deployed in India. */
  amexPosTerminals: 11_219,

  /** All 63 reporting banks, for context. */
  industryCardsOutstanding: 121_590_832,
  industryMonthlySpend: 2_013_616_739 * 1_000,
  industryMonthlyTransactions: 581_259_085,
} as const;

/**
 * American Express FY2023, the most recent year for which both sides of the
 * ratio are published together: total revenues net of interest expense of
 * $60.5B on billed business of $1.7T. The ratio is stable — FY2025 revenue of
 * $67.0B against billings that have grown at high single digits lands in the
 * same place — which is what makes it usable as a revenue yield.
 */
export const AXP_FY2023 = {
  revenueUsdMillions: 60_500,
  billedBusinessUsdMillions: 1_700_000,
} as const;

/**
 * A fully-loaded servicing seat in India. This is the one cost input that is
 * built up rather than published, so it is built up explicitly: an agent's
 * salary is roughly half of it, and supervision, facilities, telephony and
 * desktop, QA, training and attrition are the other half. 1,800 rostered hours
 * a year at 72% occupancy is the productive time inside that.
 */
export const SERVICING_SEAT = {
  loadedAnnualCostPerSeat: 1_200_000,
  rosteredHoursPerYear: 1_800,
  occupancy: 0.72,
} as const;

/* --------------------------------------------------------------------------
   Derived — the India portfolio, straight out of the RBI release
   -------------------------------------------------------------------------- */

const avgMonthlySpendPerCard =
  RBI_JUN_2026.amexMonthlySpend / RBI_JUN_2026.amexCardsOutstanding;

const industryMonthlySpendPerCard =
  RBI_JUN_2026.industryMonthlySpend / RBI_JUN_2026.industryCardsOutstanding;

/** Revenue American Express books per rupee of card spend: 3.56%. */
const revenueYieldOnSpend =
  AXP_FY2023.revenueUsdMillions / AXP_FY2023.billedBusinessUsdMillions;

/** The AmEx India card portfolio, as published. */
export const PORTFOLIO = {
  /** Credit cards outstanding — regulatory. */
  cardsInForce: RBI_JUN_2026.amexCardsOutstanding,
  /**
   * Kept as an alias so older call sites keep working, but the honest word is
   * cards: RBI counts cards, and a member may hold more than one.
   */
  members: RBI_JUN_2026.amexCardsOutstanding,
  /** ₹5.47 lakh a year per card — derived from RBI spend ÷ RBI cards × 12. */
  avgAnnualSpend: avgMonthlySpendPerCard * 12,
  /** Annual attrition. Benchmark — the first input AmEx should replace. */
  annualChurnRate: 0.13,
  /** Save rate on an at-risk member without a live signal. Benchmark. */
  saveRateToday: 0.08,
  /** Save rate when the signal arrives while the member is still in-journey. */
  saveRateWithIntervention: 0.22,
} as const;

/** What the RBI release says about AmEx's position, in ratios. */
export const MARKET_POSITION = {
  /** 1.07% of India's credit cards. */
  shareOfCards:
    RBI_JUN_2026.amexCardsOutstanding / RBI_JUN_2026.industryCardsOutstanding,
  /** 2.94% of India's credit-card spend. */
  shareOfSpend:
    RBI_JUN_2026.amexMonthlySpend / RBI_JUN_2026.industryMonthlySpend,
  /** 2.75× the industry's annual spend per card. */
  spendPerCardMultiple: avgMonthlySpendPerCard / industryMonthlySpendPerCard,
  /** ₹10,095 against an industry ₹3,464 — 2.91×. */
  avgTicket:
    RBI_JUN_2026.amexMonthlySpend / RBI_JUN_2026.amexMonthlyTransactions,
  industryAvgTicket:
    RBI_JUN_2026.industryMonthlySpend / RBI_JUN_2026.industryMonthlyTransactions,
  /** Transactions per card per month — AmEx 4.51, industry 4.78. */
  transactionsPerCardPerMonth:
    RBI_JUN_2026.amexMonthlyTransactions / RBI_JUN_2026.amexCardsOutstanding,
  industryTransactionsPerCardPerMonth:
    RBI_JUN_2026.industryMonthlyTransactions /
    RBI_JUN_2026.industryCardsOutstanding,
} as const;

/** Annual card spend across the whole India book — ₹71,121 Cr. */
const portfolioAnnualSpend = RBI_JUN_2026.amexMonthlySpend * 12;

/**
 * Revenue that spend implies for AmEx India — ₹2,532 Cr a year. Not a reported
 * figure: American Express Banking Corporation does not break India out. It is
 * the denominator that makes the model legible, because a crore figure only
 * means something next to the revenue it is a percentage of.
 */
const portfolioAnnualRevenueProxy = portfolioAnnualSpend * revenueYieldOnSpend;

/* --------------------------------------------------------------------------
   Derived — servicing
   -------------------------------------------------------------------------- */

const productiveMinutesPerSeatPerYear =
  SERVICING_SEAT.rosteredHoursPerYear * 60 * SERVICING_SEAT.occupancy;

/** ₹15.43 a minute, fully allocated. */
const servicingCostPerMinute =
  SERVICING_SEAT.loadedAnnualCostPerSeat / productiveMinutesPerSeatPerYear;

/** Assisted contacts per card per year, call centre and branch. Benchmark. */
const CONTACTS_PER_CARD_PER_YEAR = 2.0;
/** Average handle time for a premium assisted contact, in minutes. */
const AVG_HANDLE_TIME_MINUTES = 9;

/** Servicing model — the handle-time stream. */
export const SERVICING = {
  contactsPerCardPerYear: CONTACTS_PER_CARD_PER_YEAR,
  /** 2.60M contacts a year — derived from the RBI card count. */
  annualAssistedContacts: PORTFOLIO.cardsInForce * CONTACTS_PER_CARD_PER_YEAR,
  avgHandleTimeMinutes: AVG_HANDLE_TIME_MINUTES,
  /** ₹139 — derived from a loaded seat, not asserted. */
  costPerAssistedContact: servicingCostPerMinute * AVG_HANDLE_TIME_MINUTES,
  /** AHT reduction when the cross-channel history is already on screen. */
  ahtReductionRate: 0.20,
} as const;

/** Cross-sell model — the funnel-recovery stream. */
export const CROSS_SELL = {
  /**
   * Extra conversion on portfolio spend, unlocked by seeing where the journey
   * breaks. The softest input in the model, and the largest single lever on the
   * total — a director who wants to halve the headline should halve this.
   */
  incrementalConversionRate: 0.015,
  /** Revenue AmEx books on that incremental spend — the FY2023 yield. */
  revenueRate: revenueYieldOnSpend,
} as const;

/**
 * What a retained card is worth for a further year.
 *
 * Low end: one year of the revenue that card generates — its annual spend at
 * AmEx's own revenue yield. Card fees are already inside that yield, so they
 * are not added again; double-counting a stream is the error this module was
 * written to avoid.
 *
 * High end: the same revenue plus a 25% allowance for what it costs to acquire
 * a replacement member. That allowance is an allowance, not a source — it is
 * listed as one on screen.
 */
const marginLow = PORTFOLIO.avgAnnualSpend * revenueYieldOnSpend;
const REACQUISITION_ALLOWANCE = 0.25;
export const MARGIN_PER_RETAINED_MEMBER = {
  low: marginLow,
  high: marginLow * (1 + REACQUISITION_ALLOWANCE),
} as const;

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
  cardsInForce: PORTFOLIO.cardsInForce,
  avgAnnualSpend: PORTFOLIO.avgAnnualSpend,
  costPerAssistedContact: SERVICING.costPerAssistedContact,
  ahtReductionRate: SERVICING.ahtReductionRate,
  annualAssistedContacts: SERVICING.annualAssistedContacts,
  minutesSavedPerInformedContact,
  servicingCostPerMinute,
  revenueYieldOnSpend,
  churnSaveRate,
  /** Conservative end of the range, so live figures never overstate. */
  annualMarginPerRetainedCustomer: MARGIN_PER_RETAINED_MEMBER.low,
  portfolioAnnualSpend,
  portfolioAnnualRevenueProxy,
} as const;

/* --------------------------------------------------------------------------
   Provenance — what each input is, and where it came from
   -------------------------------------------------------------------------- */

export type InputKind = "regulatory" | "reported" | "derived" | "benchmark";

export const SOURCED_INPUTS: {
  label: string;
  value: string;
  kind: InputKind;
  source: string;
}[] = [
  {
    label: "Cards in force, AmEx India",
    value: PORTFOLIO.cardsInForce.toLocaleString("en-IN"),
    kind: "regulatory",
    source: "RBI bank-wise card statistics, June 2026 (provisional)",
  },
  {
    label: "Annual spend per card",
    // Two decimals here, not inr()'s one: this is the input the whole model
    // pivots on, and ₹5.5L hides a 4% difference from ₹5.47L.
    value: `₹${(PORTFOLIO.avgAnnualSpend / 100_000).toFixed(2)}L`,
    kind: "derived",
    source: "RBI June 2026 spend ÷ cards outstanding × 12",
  },
  {
    label: "Revenue AmEx books per ₹ of spend",
    value: `${(revenueYieldOnSpend * 100).toFixed(2)}%`,
    kind: "reported",
    source: "AmEx FY2023: $60.5B revenue on $1.7T billed business",
  },
  {
    label: "Retained card, annual value",
    value: `${inr(MARGIN_PER_RETAINED_MEMBER.low)}–${inr(MARGIN_PER_RETAINED_MEMBER.high).slice(1)}`,
    kind: "derived",
    source: `Spend × yield, high end + ${Math.round(REACQUISITION_ALLOWANCE * 100)}% re-acquisition allowance`,
  },
  {
    label: "Assisted contact, fully allocated",
    value: inr(SERVICING.costPerAssistedContact),
    kind: "derived",
    source: `₹${SERVICING_SEAT.loadedAnnualCostPerSeat.toLocaleString("en-IN")} loaded seat ÷ ${productiveMinutesPerSeatPerYear.toLocaleString("en-IN")} productive minutes × ${SERVICING.avgHandleTimeMinutes} min`,
  },
  {
    label: "Assisted contacts a year",
    value: `${(SERVICING.annualAssistedContacts / 1_000_000).toFixed(2)}M`,
    kind: "benchmark",
    source: `${SERVICING.contactsPerCardPerYear.toFixed(1)} contacts per card per year × cards in force`,
  },
  {
    label: "AHT reduction with context",
    value: `${Math.round(SERVICING.ahtReductionRate * 100)}%`,
    kind: "benchmark",
    source: "Industry range for unified-context servicing is 15–25%; middle taken",
  },
  {
    label: "Annual attrition",
    value: `${Math.round(PORTFOLIO.annualChurnRate * 100)}%`,
    kind: "benchmark",
    source: "Indian premium card benchmark — replace with AmEx's own attrition",
  },
  {
    label: "Save rate, today → with alerts",
    value: `${Math.round(PORTFOLIO.saveRateToday * 100)}% → ${Math.round(PORTFOLIO.saveRateWithIntervention * 100)}%`,
    kind: "benchmark",
    source: "Retention benchmark for acting on a live signal vs a monthly report",
  },
  {
    label: "Incremental cross-sell conversion",
    value: `${(CROSS_SELL.incrementalConversionRate * 100).toFixed(1)}%`,
    kind: "benchmark",
    source: "The softest input here, and the largest lever on the total",
  },
];

/**
 * Kept for components that only need label and value.
 * @deprecated Prefer SOURCED_INPUTS, which carries the provenance too.
 */
export const ASSUMPTION_NOTES: { label: string; value: string }[] =
  SOURCED_INPUTS.map(({ label, value }) => ({ label, value }));

/**
 * The three inputs the *live* figures depend on. The hero band quotes these;
 * the portfolio model quotes all ten. Listing everything in both places would
 * say the same thing twice on one page.
 */
export const LIVE_FIGURE_NOTES: { label: string; value: string }[] = [
  {
    label: "Cards in force (RBI, Jun 2026)",
    value: PORTFOLIO.cardsInForce.toLocaleString("en-IN"),
  },
  {
    label: "Assisted contact, fully allocated",
    value: inr(SERVICING.costPerAssistedContact),
  },
  {
    label: "Save-rate improvement on a live signal",
    value: `${Math.round(churnSaveRate * 100)} percentage points`,
  },
  {
    label: "Retained card, annual value",
    value: `${inr(MARGIN_PER_RETAINED_MEMBER.low)} (conservative end)`,
  },
];

/* --------------------------------------------------------------------------
   The three streams, at portfolio scale
   -------------------------------------------------------------------------- */

const cardsM = (PORTFOLIO.cardsInForce / 1_000_000).toFixed(2);

/** Stream 1 — churn prevented by acting on a signal while it is still live. */
export function churnPreventionImpact() {
  const atRisk = PORTFOLIO.cardsInForce * PORTFOLIO.annualChurnRate;
  const saves = atRisk * churnSaveRate;
  return {
    atRisk,
    saves,
    low: saves * MARGIN_PER_RETAINED_MEMBER.low,
    high: saves * MARGIN_PER_RETAINED_MEMBER.high,
    basis: `${cardsM}M cards × ${Math.round(PORTFOLIO.annualChurnRate * 100)}% attrition × ${Math.round(churnSaveRate * 100)}pp better save rate × ${inr(MARGIN_PER_RETAINED_MEMBER.low)}`,
  };
}

/** Stream 2 — conversions recovered where the cross-channel funnel breaks. */
export function crossSellImpact() {
  const perYear =
    portfolioAnnualSpend *
    CROSS_SELL.incrementalConversionRate *
    CROSS_SELL.revenueRate;
  return {
    perYear,
    basis: `₹${Math.round(portfolioAnnualSpend / 10_000_000).toLocaleString("en-IN")}Cr portfolio spend × ${(CROSS_SELL.incrementalConversionRate * 100).toFixed(1)}% conversion × ${(CROSS_SELL.revenueRate * 100).toFixed(2)}% revenue yield`,
  };
}

/** Stream 3 — handle time an agent no longer spends re-establishing context. */
export function ahtImpact() {
  const perYear =
    SERVICING.annualAssistedContacts *
    SERVICING.costPerAssistedContact *
    SERVICING.ahtReductionRate;
  return {
    perYear,
    basis: `${(SERVICING.annualAssistedContacts / 1_000_000).toFixed(2)}M contacts × ${inr(SERVICING.costPerAssistedContact)} × ${Math.round(SERVICING.ahtReductionRate * 100)}%`,
  };
}

/**
 * The whole opportunity. Ordered by size, which is not the order the deck put
 * them in: once servicing is priced at an Indian cost, handle time is the
 * smallest of the three and retention is the largest.
 */
export function totalOpportunity() {
  const churn = churnPreventionImpact();
  const cross = crossSellImpact();
  const aht = ahtImpact();
  const low = churn.low + cross.perYear + aht.perYear;
  const high = churn.high + cross.perYear + aht.perYear;
  return {
    low,
    high,
    /** The total as a share of the revenue AmEx India's card spend implies. */
    shareOfRevenueLow: low / portfolioAnnualRevenueProxy,
    shareOfRevenueHigh: high / portfolioAnnualRevenueProxy,
    revenueProxy: portfolioAnnualRevenueProxy,
    streams: [
      {
        key: "churn",
        label: "Churn prevention",
        low: churn.low,
        high: churn.high,
        basis: churn.basis,
        detail: `≈${Math.round(churn.saves).toLocaleString("en-IN")} cards retained a year`,
      },
      {
        key: "cross",
        label: "Cross-sell recovery",
        low: cross.perYear,
        high: cross.perYear,
        basis: cross.basis,
        detail: "Funnel drop-off recovered across web, app and branch",
      },
      {
        key: "aht",
        label: "Handle-time reduction",
        low: aht.perYear,
        high: aht.perYear,
        basis: aht.basis,
        detail: `${minutesSavedPerInformedContact.toFixed(1)} minutes off a ${SERVICING.avgHandleTimeMinutes}-minute contact`,
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
 * telling is either shorter or unnecessary.
 *
 * Two readings come back. `perYear` annualises the measured window as-is, which
 * is the honest number for the cohort actually observed. `portfolioPerYear`
 * takes the *rate* we measured and applies it to the 1.30M cards RBI says are
 * in force — a measured rate, projected onto a published base, which is the
 * only way a demo-sized cohort says anything about the book.
 */
export function repeatContactValue(
  repeatCustomers: number,
  windowDays = 30,
  cohortSize?: number,
) {
  const perWindow = repeatCustomers * SERVICING.costPerAssistedContact;
  const perYear = (perWindow / windowDays) * 365;
  const rate = cohortSize && cohortSize > 0 ? repeatCustomers / cohortSize : null;
  return {
    perWindow,
    perMonth: (perWindow / windowDays) * 30,
    perYear,
    /** Share of the observed cohort that contacted twice or more. */
    rate,
    portfolioPerYear:
      rate === null ? null : perYear * (PORTFOLIO.cardsInForce / cohortSize!),
  };
}

/** Handle-time value across a measured volume of assisted contacts. */
export function handleTimeValue(assistedContacts: number) {
  const minutes = assistedContacts * minutesSavedPerInformedContact;
  return { minutes, value: minutes * servicingCostPerMinute };
}

/**
 * Value of churn signals surfaced early enough to act on. Conservative end of
 * the retained-card range, so a live figure never overstates. Pass `cohortSize`
 * to also get the same signal rate projected onto the RBI card base.
 */
export function churnSaveValue(openSignals: number, cohortSize?: number) {
  const saves = openSignals * churnSaveRate;
  const perYear = saves * MARGIN_PER_RETAINED_MEMBER.low;
  const rate = cohortSize && cohortSize > 0 ? openSignals / cohortSize : null;
  return {
    saves,
    perYear,
    perYearHigh: saves * MARGIN_PER_RETAINED_MEMBER.high,
    rate,
    portfolioPerYear:
      rate === null ? null : perYear * (PORTFOLIO.cardsInForce / cohortSize!),
  };
}

/* --------------------------------------------------------------------------
   Formatting
   -------------------------------------------------------------------------- */

/** Compact Indian currency — ₹71,121Cr, ₹91Cr, ₹9.4Cr, ₹5.5L, ₹19.5k, ₹139. */
export function inr(n: number): string {
  const v = Math.round(n);
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (Math.abs(v) >= 10_000_000) {
    const cr = v / 10_000_000;
    // Headline-sized figures read as whole crore; nobody quotes ₹91.3Cr. Past
    // ten thousand crore the digits need grouping — ₹71,121Cr, not ₹71121Cr.
    if (Math.abs(cr) >= 10) return `₹${Math.round(cr).toLocaleString("en-IN")}Cr`;
    return `₹${trim(cr.toFixed(1))}Cr`;
  }
  if (Math.abs(v) >= 100_000) return `₹${trim((v / 100_000).toFixed(1))}L`;
  if (Math.abs(v) >= 1_000) return `₹${trim((v / 1000).toFixed(1))}k`;
  return `₹${v.toLocaleString("en-IN")}`;
}

/** A range that shares its unit — ₹91–103Cr, not ₹91Cr–₹103Cr. */
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
  return `${lo}–${hi.slice(1)}`;
}
