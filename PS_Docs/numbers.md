# Talking the numbers

One page. What to say, in what order, and what to say when it is challenged.

---

## The one figure to lead with

> **₹237–256 Crore a year**, on AmEx India's 2 million premium card members.

Not ₹312 Cr. The deck's own three streams sum to ₹237–256 Cr; ₹312 is
`237 + 75`, the cross-sell line added a second time to a total that already
contained it. Lead with the smaller number — it is the defensible one, and a
director who reconstructs your total in their head and gets a different answer
stops listening to everything after it.

It is a **range**, not a point, because one of the three streams is a range
(₹19.8k–25k annual margin on a retained member). Say "two thirty-seven to two
fifty-six" out loud. A range read confidently sounds like modelling; a point
figure invites "how do you know it's exactly that?"

## Then break it into three, in this order

| | Stream | The sentence | Figure |
|---|---|---|---|
| 1 | Churn prevention | 2M members, 13% leave a year, and a live signal moves the save rate from 8% to 22% — about **36,400 members kept**. | ₹72–91 Cr |
| 2 | Handle-time reduction | 3M assisted contacts a year, each 20% shorter when the agent already has the cross-channel history. | ₹90 Cr |
| 3 | Cross-sell recovery | 1.5% more conversions on ₹2 lakh crore of portfolio spend, at a 2.5% revenue rate. | ₹75 Cr |

Churn first because it is the largest and the most emotive. Handle time second
because it is the one an operations director can verify from their own MIS
tomorrow. Cross-sell last because it is the softest.

## The anchor: ₹300

Zoom all the way in before you zoom out:

> "One informed contact saves 1.8 minutes of a 9-minute call. That is **₹300**.
> The only reason this becomes a crore figure is that it happens three million
> times a year — which is exactly why it has to be sub-second and automatic,
> not a report somebody reads on Monday."

This is the most useful thing to say in the whole money section. It converts an
abstract ₹90 Cr into one call the listener can picture, and it turns the
architecture into a *consequence* of the business case rather than a separate
technical slide.

## Measured vs modelled — say which is which, unprompted

The dashboard now draws a hard rule between the two, and you should mirror it in
speech:

- **Above the rule** — customers unified, p95 latency, precision/recall, open
  signals. Measured. This system produced these.
- **Below the rule** ("Modelled, not measured") — the ₹237–256 Cr. A model, on
  stated inputs, six of which are listed on screen.

Volunteering the distinction is what buys you credibility for the modelled half.
If you blur them and someone notices, they will retroactively distrust the
measured half too.

---

## The three questions you will get

**"Where does ₹1,500 per contact come from? Our agents don't cost that."**

> It is not a wage. It is the fully-allocated cost of one premium assisted
> contact — servicing platform, workforce management, floor space, QA and
> supervision, loaded onto the contact. Swap in your own figure and every rupee
> on the screen recalculates; the input is one line of config.

That last clause matters more than the number. And it is honest: ₹1,500 is
exactly the cost that makes the deck's own ₹90 Cr line arithmetically true. At a
bare ₹150 agent cost the stream is ₹9 Cr and the total is ₹156–175 Cr — still a
serious number, and the app will print it if you flip
`COST_PER_ASSISTED_CONTACT` in `frontend/lib/economics.ts`.

**"8% to 22% save rate — whose number is that?"**

> Industry benchmark for real-time intervention versus post-hoc outreach. It is
> the single input the whole churn stream rests on, which is why it is on the
> screen instead of in a footnote. Halve the improvement and the stream is
> ₹36–45 Cr. The case does not depend on the optimistic end.

Pre-empting the halved case is stronger than defending the full one.

**"Why not just build this in the warehouse?"**

> Because the value is in the word *live*. A member who has told you the same
> story twice is on their way out; the margin is in reaching them during the
> second contact, not in a Monday report about it. That is the whole reason for
> Redis Streams and a 15-millisecond p95 rather than a nightly batch job.

---

## Two edits your slides need

1. **₹312 Crore → ₹237–256 Crore.** Cross-sell is double-counted in the ₹312.
2. **"avg ₹150/call × 20% → ₹90 Cr" → "₹1,500 fully allocated × 20% → ₹90 Cr".**
   3M × ₹150 × 20% is ₹9 Cr, not ₹90 Cr — off by a factor of ten. The ₹90 Cr is
   the figure worth keeping; the per-call cost is the one to fix.

Also: the deck says accuracy is measured "against a 100-customer ground truth".
`data/customers.json` has **1,000**. Fix the slide upward — the larger number is
both true and better.

## Where each figure lives in the code

Everything derives from named inputs in `frontend/lib/economics.ts`. No rupee
total is hard-coded anywhere, so a challenged input changes exactly the figures
it should.

| On screen | Component |
|---|---|
| Hero band — avoidable servicing cost, retained margin | `app/components/VerdictBand.tsx` |
| The ₹237–256 Cr model, three streams, six inputs | `app/components/OpportunityModel.tsx` |
| Per-member servicing saving on one journey | `app/dashboard/customers/[id]/page.tsx` |
| Repeat contacts, priced over the actual window | `app/dashboard/repeat-contacts/page.tsx` |
