"""The cost model, with its sources — GET /api/economics.

Why this is an endpoint and not a slide
---------------------------------------
The dashboard puts crore figures in front of people who know AmEx's own card
count and its own servicing costs. A figure that cannot be traced to a source
is worth less than no figure at all, so every input the interface uses is
served here with its value, its derivation and where it came from. A judge, or
a director, can curl this and check the arithmetic without reading the code:

    curl -s localhost:8000/api/economics | jq '.inputs[] | {label, value, kind, source}'
    curl -s localhost:8000/api/economics | jq '.streams'
    curl -s localhost:8000/api/economics?attrition=0.09

Every input is one of four kinds:

    regulatory  RBI's published bank-wise card statistics. Not arguable.
    reported    American Express's own reported financials.
    derived     Arithmetic on the two above, shown in full.
    benchmark   An industry figure or a stated allowance. Arguable — and the
                first thing AmEx should overwrite with its own data.

The frontend holds the identical raw inputs in frontend/lib/economics.ts so the
dashboard can render without a round trip. The two must stay in step; the raw
inputs below are the ones to change, and there are only nine of them.
"""
from __future__ import annotations

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api", tags=["economics"])


# ---------------------------------------------------------------------------
# Raw inputs — the only hand-typed numbers in the model
# ---------------------------------------------------------------------------

RBI_JUN_2026 = {
    # RBI, "ATM, Acceptance Infrastructure and Card Statistics for the Month of
    # June 2026" (provisional), bank-wise sheet, American Express Banking
    # Corporation. AmEx India issues no debit cards and runs no ATMs, so credit
    # cards are the whole book. RBI publishes value in thousands of rupees.
    "url": "https://www.rbi.org.in/Scripts/ATMView.aspx?atmid=184",
    "amex_cards_outstanding": 1_300_853,
    "amex_monthly_spend_inr": 59_267_497 * 1_000,
    "amex_monthly_transactions": 5_871_438,
    "amex_pos_terminals": 11_219,
    # All 63 reporting banks, for context.
    "industry_cards_outstanding": 121_590_832,
    "industry_monthly_spend_inr": 2_013_616_739 * 1_000,
    "industry_monthly_transactions": 581_259_085,
}

# FY2023 is the most recent year with both sides of the ratio published
# together: $60.5B of revenue net of interest expense on $1.7T of billed
# business. The ratio is stable — FY2025's $67.0B against billings growing at
# high single digits lands in the same place — which is what makes it usable.
AXP_FY2023 = {"revenue_usd_m": 60_500, "billed_business_usd_m": 1_700_000}

# The one cost input that is built up rather than published, so it is built up
# explicitly. Salary is roughly half of a loaded seat; supervision, facilities,
# telephony and desktop, QA, training and attrition are the other half.
SERVICING_SEAT = {
    "loaded_annual_cost_per_seat_inr": 1_200_000,
    "rostered_hours_per_year": 1_800,
    "occupancy": 0.72,
}

# Benchmarks. These are the arguable ones, and they are the query parameters.
DEFAULTS = {
    "attrition": 0.13,
    "save_rate_today": 0.08,
    "save_rate_with_intervention": 0.22,
    "contacts_per_card_per_year": 2.0,
    "avg_handle_time_minutes": 9.0,
    "aht_reduction_rate": 0.20,
    "cross_sell_conversion_rate": 0.015,
    "reacquisition_allowance": 0.25,
}

CR = 10_000_000  # one crore


def _cr(n: float) -> float:
    """Rupees to crore, two decimals — the unit the room actually speaks in."""
    return round(n / CR, 2)


@router.get("/economics")
async def economics(
    attrition: float = Query(
        DEFAULTS["attrition"], ge=0, le=1,
        description="Annual card attrition. Benchmark — override with AmEx's own.",
    ),
    save_rate_today: float = Query(DEFAULTS["save_rate_today"], ge=0, le=1),
    save_rate_with_intervention: float = Query(
        DEFAULTS["save_rate_with_intervention"], ge=0, le=1
    ),
    contacts_per_card_per_year: float = Query(
        DEFAULTS["contacts_per_card_per_year"], ge=0, le=50
    ),
    avg_handle_time_minutes: float = Query(
        DEFAULTS["avg_handle_time_minutes"], gt=0, le=120
    ),
    aht_reduction_rate: float = Query(DEFAULTS["aht_reduction_rate"], ge=0, le=1),
    cross_sell_conversion_rate: float = Query(
        DEFAULTS["cross_sell_conversion_rate"], ge=0, le=1
    ),
    reacquisition_allowance: float = Query(
        DEFAULTS["reacquisition_allowance"], ge=0, le=5
    ),
):
    """Every input behind the money on the dashboard, with its source.

    All eight benchmark inputs are query parameters, because the honest answer
    to "your churn number is wrong" is to change it in front of the person who
    said so and read the new total off the screen. The regulatory and reported
    inputs are not parameters — those are not ours to move.
    """
    r = RBI_JUN_2026

    # --- the portfolio, straight out of the RBI release ---------------------
    cards = r["amex_cards_outstanding"]
    monthly_spend_per_card = r["amex_monthly_spend_inr"] / cards
    annual_spend_per_card = monthly_spend_per_card * 12
    portfolio_annual_spend = r["amex_monthly_spend_inr"] * 12

    industry_monthly_spend_per_card = (
        r["industry_monthly_spend_inr"] / r["industry_cards_outstanding"]
    )

    # --- what AmEx earns per rupee of spend --------------------------------
    revenue_yield = AXP_FY2023["revenue_usd_m"] / AXP_FY2023["billed_business_usd_m"]

    # Not a reported figure: American Express Banking Corporation does not break
    # India out. It is the denominator that makes a crore figure legible.
    revenue_proxy = portfolio_annual_spend * revenue_yield

    # --- what a retained card is worth -------------------------------------
    # Card fees are already inside the revenue yield, so they are not added
    # again. Double-counting a stream is the error this model exists to avoid.
    margin_low = annual_spend_per_card * revenue_yield
    margin_high = margin_low * (1 + reacquisition_allowance)

    # --- servicing ---------------------------------------------------------
    productive_minutes = (
        SERVICING_SEAT["rostered_hours_per_year"] * 60 * SERVICING_SEAT["occupancy"]
    )
    cost_per_minute = (
        SERVICING_SEAT["loaded_annual_cost_per_seat_inr"] / productive_minutes
    )
    cost_per_contact = cost_per_minute * avg_handle_time_minutes
    annual_contacts = cards * contacts_per_card_per_year

    # --- the three streams -------------------------------------------------
    save_rate_lift = save_rate_with_intervention - save_rate_today
    at_risk = cards * attrition
    saves = at_risk * save_rate_lift
    churn_low, churn_high = saves * margin_low, saves * margin_high

    cross_sell = portfolio_annual_spend * cross_sell_conversion_rate * revenue_yield
    aht = annual_contacts * cost_per_contact * aht_reduction_rate

    total_low = churn_low + cross_sell + aht
    total_high = churn_high + cross_sell + aht

    return {
        "headline": {
            "annual_opportunity_cr": [_cr(total_low), _cr(total_high)],
            "as_share_of_amex_india_card_revenue": [
                round(total_low / revenue_proxy * 100, 1),
                round(total_high / revenue_proxy * 100, 1),
            ],
            "basis": (
                f"{cards:,} AmEx India cards in force (RBI, June 2026), spending "
                f"₹{_cr(portfolio_annual_spend):,.0f} Cr a year"
            ),
            "note": (
                "A model on stated inputs, not a measurement. The measured "
                "figures are precision, recall and latency at /api/metrics."
            ),
        },
        # Ordered by size, which is not the order the deck put them in: once
        # servicing is priced at an Indian cost, handle time is the smallest of
        # the three and retention is the largest.
        "streams": [
            {
                "key": "churn",
                "label": "Churn prevention",
                "annual_cr": [_cr(churn_low), _cr(churn_high)],
                "derivation": (
                    f"{cards:,} cards × {attrition:.0%} attrition × "
                    f"{save_rate_lift * 100:.0f}pp save-rate lift × "
                    f"₹{margin_low:,.0f}–{margin_high:,.0f} per retained card"
                ),
                "cards_retained_per_year": round(saves),
                "softest_input": "attrition and save-rate lift are both benchmarks",
            },
            {
                "key": "cross_sell",
                "label": "Cross-sell recovery",
                "annual_cr": [_cr(cross_sell), _cr(cross_sell)],
                "derivation": (
                    f"₹{_cr(portfolio_annual_spend):,.0f} Cr portfolio spend × "
                    f"{cross_sell_conversion_rate:.1%} incremental conversion × "
                    f"{revenue_yield:.2%} revenue yield"
                ),
                "softest_input": (
                    "the incremental conversion rate is the softest input in the "
                    "whole model and the largest single lever on the total"
                ),
            },
            {
                "key": "aht",
                "label": "Handle-time reduction",
                "annual_cr": [_cr(aht), _cr(aht)],
                "derivation": (
                    f"{annual_contacts:,.0f} contacts × ₹{cost_per_contact:,.0f} "
                    f"fully allocated × {aht_reduction_rate:.0%} reduction"
                ),
                "minutes_saved_per_contact": round(
                    avg_handle_time_minutes * aht_reduction_rate, 1
                ),
                "softest_input": (
                    "smaller than the deck claimed, because Indian servicing is "
                    "cheap — ₹1,500 a contact was never an Indian cost"
                ),
            },
        ],
        "inputs": [
            {
                "key": "cards_in_force",
                "label": "Cards in force, AmEx India",
                "value": cards,
                "unit": "cards",
                "kind": "regulatory",
                "source": "RBI bank-wise card statistics, June 2026 (provisional)",
                "url": r["url"],
            },
            {
                "key": "annual_spend_per_card",
                "label": "Annual spend per card",
                "value": round(annual_spend_per_card),
                "unit": "INR",
                "kind": "derived",
                "derivation": (
                    f"₹{r['amex_monthly_spend_inr']:,} monthly spend ÷ {cards:,} "
                    f"cards × 12"
                ),
                "source": "RBI bank-wise card statistics, June 2026",
                "url": r["url"],
            },
            {
                "key": "revenue_yield_on_spend",
                "label": "Revenue AmEx books per rupee of card spend",
                "value": round(revenue_yield, 5),
                "unit": "ratio",
                "kind": "reported",
                "derivation": (
                    f"${AXP_FY2023['revenue_usd_m']:,}M revenue net of interest "
                    f"expense ÷ ${AXP_FY2023['billed_business_usd_m']:,}M billed "
                    f"business (FY2023)"
                ),
                "source": "American Express FY2023 results",
            },
            {
                "key": "margin_per_retained_card",
                "label": "Retained card, annual value",
                "value": [round(margin_low), round(margin_high)],
                "unit": "INR",
                "kind": "derived",
                "derivation": (
                    "annual spend × revenue yield; high end adds a "
                    f"{reacquisition_allowance:.0%} allowance for re-acquiring a "
                    "replacement member. Card fees sit inside the yield already "
                    "and are not added twice."
                ),
                "source": "RBI spend × AmEx FY2023 yield",
            },
            {
                "key": "cost_per_assisted_contact",
                "label": "Assisted contact, fully allocated",
                "value": round(cost_per_contact, 2),
                "unit": "INR",
                "kind": "derived",
                "derivation": (
                    f"₹{SERVICING_SEAT['loaded_annual_cost_per_seat_inr']:,} loaded "
                    f"seat ÷ {productive_minutes:,.0f} productive minutes "
                    f"({SERVICING_SEAT['rostered_hours_per_year']:,} rostered hours × "
                    f"{SERVICING_SEAT['occupancy']:.0%} occupancy) × "
                    f"{avg_handle_time_minutes:g} min = ₹{cost_per_minute:.2f}/min"
                ),
                "source": (
                    "Built up from an Indian servicing seat. The deck's ₹1,500 "
                    "implies ₹167 a minute, which is not an Indian cost."
                ),
            },
            {
                "key": "contacts_per_card_per_year",
                "label": "Assisted contacts per card per year",
                "value": contacts_per_card_per_year,
                "unit": "contacts",
                "kind": "benchmark",
                "derivation": f"× {cards:,} cards = {annual_contacts:,.0f} a year",
                "source": "Card-servicing benchmark — replace with AmEx volumes",
            },
            {
                "key": "aht_reduction_rate",
                "label": "AHT reduction with cross-channel context on screen",
                "value": aht_reduction_rate,
                "unit": "ratio",
                "kind": "benchmark",
                "source": "Industry range for unified-context servicing is 15–25%",
            },
            {
                "key": "attrition",
                "label": "Annual attrition",
                "value": attrition,
                "unit": "ratio",
                "kind": "benchmark",
                "source": (
                    "Indian premium-card benchmark. The first input AmEx should "
                    "replace with its own number."
                ),
            },
            {
                "key": "save_rate",
                "label": "Save rate, today → with a live signal",
                "value": [save_rate_today, save_rate_with_intervention],
                "unit": "ratio",
                "kind": "benchmark",
                "source": (
                    "Retention benchmark for acting while the member is still "
                    "in-journey versus reading it in a monthly report"
                ),
            },
            {
                "key": "cross_sell_conversion_rate",
                "label": "Incremental cross-sell conversion on portfolio spend",
                "value": cross_sell_conversion_rate,
                "unit": "ratio",
                "kind": "benchmark",
                "source": (
                    "The softest input in the model. Halve it to halve the "
                    "cross-sell stream."
                ),
            },
        ],
        # Ratios out of the same RBI release. These are the lines that survive
        # scrutiny best, because they are two published numbers divided.
        "market_position": {
            "share_of_indian_credit_cards_pct": round(
                cards / r["industry_cards_outstanding"] * 100, 2
            ),
            "share_of_indian_credit_card_spend_pct": round(
                r["amex_monthly_spend_inr"] / r["industry_monthly_spend_inr"] * 100, 2
            ),
            "spend_per_card_vs_industry": round(
                monthly_spend_per_card / industry_monthly_spend_per_card, 2
            ),
            "avg_ticket_inr": round(
                r["amex_monthly_spend_inr"] / r["amex_monthly_transactions"]
            ),
            "industry_avg_ticket_inr": round(
                r["industry_monthly_spend_inr"] / r["industry_monthly_transactions"]
            ),
            "transactions_per_card_per_month": round(
                r["amex_monthly_transactions"] / cards, 2
            ),
            "reading": (
                "AmEx holds about 1.07% of India's credit cards but carries "
                "2.94% of the spend on them — 2.75× the industry's spend per "
                "card. A small, high-value book is exactly the book where "
                "losing one member costs the most, and where getting identity "
                "resolution wrong is most expensive."
            ),
            "as_of": "June 2026 (RBI provisional)",
            "source": r["url"],
        },
        "portfolio": {
            "cards_in_force": cards,
            "annual_card_spend_cr": _cr(portfolio_annual_spend),
            "annual_card_revenue_proxy_cr": _cr(revenue_proxy),
            "revenue_proxy_note": (
                "Not a reported figure. American Express Banking Corporation "
                "does not break India out; this is RBI spend × AmEx's reported "
                "revenue yield, used only as a denominator."
            ),
            "pos_terminals": r["amex_pos_terminals"],
        },
        "how_to_argue_with_this": {
            "note": (
                "Eight of these inputs are query parameters. Change one and read "
                "the new total — nothing here is hard-coded to a rupee figure."
            ),
            "examples": [
                "/api/economics?attrition=0.09",
                "/api/economics?cross_sell_conversion_rate=0.005",
                "/api/economics?avg_handle_time_minutes=6&aht_reduction_rate=0.15",
            ],
            "what_this_does_not_claim": [
                "It is not a measurement. Precision, recall and latency at "
                "/api/metrics are the measured numbers.",
                "It prices handle time, not whole avoided contacts, so it "
                "understates the servicing stream.",
                "It excludes NPS, the regulatory value of the audit trail, and "
                "the fraud signal a stitched cross-channel timeline produces.",
            ],
        },
    }
