# Competitor prices: Otter, Fireflies, Granola, Claude

Internal record, checked on **2026-11-25** against each vendor's own pages. All pages returned HTTP 200.
Amounts are list prices in dollars as served to the machine that fetched them; other regions may differ.
The repository held no earlier competitor price figures, so there was nothing to correct.

**Before publishing any of these:** fetch the source page again that day and update this record. Always state
the billing period with the amount: for most paid plans below it changes the number.

## Otter

Source: <https://otter.ai/pricing> (the page says "Prices in USD")

| Plan | Billed monthly | Billed annually (monthly equivalent) |
| --- | --- | --- |
| Basic | Free | Free |
| Pro, per user per month | $16.99 | $8.33 |
| Business, per user per month | $30 | $19.99 |
| Enterprise | Custom pricing | Custom pricing |

Do not quote these as list prices:

- $24 for Business monthly is an offer: 20% off for 3 months.
- $8.49 (Pro monthly) and $4.17 (Pro annual) apply only to an India-issued credit card.
- A Black Friday banner offered 50% off Pro annual and Business annual with a code.

## Fireflies

Source: <https://fireflies.ai/pricing>. The annual amounts are in the visible text. The monthly amounts are in the
page source, behind the Monthly/Annual toggle (`monthlyPriceDescription`).

| Plan | Billed monthly | Billed annually (monthly equivalent) |
| --- | --- | --- |
| Free | $0 | $0 |
| Pro, per seat per month | $18 | $10 |
| Business, per seat per month | $29 | $19 |
| Enterprise, per seat per month | Annual only | $39 |

## Granola

Sources: <https://www.granola.ai/pricing>,
<https://docs.granola.ai/help-center/managing-your-account/subscriptions-and-billing.md> and
<https://docs.granola.ai/help-center/managing-your-account/understanding-your-invoice.md>

| Plan | Price per user per month | Billing |
| --- | --- | --- |
| Basic | $0 | Free |
| Business | $14 | Monthly only |
| Enterprise | From $35 | Monthly or annual |

The pricing page shows $35 for Enterprise without "from" and does not state the billing period. The "from" and the
billing periods come from the subscriptions article. It gives no separate annual amount.

## Claude

Source: <https://claude.com/pricing>. The page says prices exclude tax, can change, and that usage limits apply.

| Plan | Billed monthly | Billed annually |
| --- | --- | --- |
| Free | $0 | $0 |
| Pro, per month | $20 | $17 equivalent ($200 up front) |
| Max, per month | $100 | No annual price shown |
| Ultra, per month | $200 | No annual price shown |
| Team standard seat, per month (2 to 150 people) | $25 | $20 equivalent |
| Team premium seat, per month (2 to 150 people) | $125 | $100 equivalent |
| Enterprise | No monthly price shown | $20 per seat per month plus usage at API rates, 20-seat minimum |

The pricing page does not mention meetings. It therefore does **not** verify which plan includes the Claude
Meetings beta named in the product charter, or what it costs. Do not attach a price to Claude Meetings from this
table.

## Not covered

Plan limits and features, API token prices, taxes, regional prices, and other competitors (Fathom, Microsoft
Facilitator, AgentCall) were not verified.
