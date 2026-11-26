# Launch price, and whether the first sale needs the avatar

Task #22751, written 2026-11-25. **Status: recommendation, waiting for the owner.** Pricing is the owner's decision
(rulings R6426 and R6430). No price, checkout or Stripe setting was changed.

## Owner action

> Approve or change: launch price of **$119 one-time per computer, with 1 year of updates** (no subscription), and
> **the avatar is not required for the first sale**.

Approving this does not start a launch or resume development: Meeteor is outside the R10659 lineup.

## Price: $119 one-time per computer

The licence is for one installation (a person's computer or a room device). The app keeps working after the year of
updates ends. The customer supplies the AI: a local model, or their own account or key.

Reasons:

- It fits a local, botless product with no hosted service. The desktop licence is already a signed key that is
  checked offline (`verifyLicenseV2` in `server.js`), and `ROADMAP.md` says it carries an update date.
- $119 is already the one-time amount on `landing.html` and in `/checkout/create`.
- A one-time licence needs no renewal enforcement. The $29.95 annual plan does: the key checkout issues for it holds
  only `type` and `issued`, with no expiry. Recommend dropping that plan.
- It replaces the June $69.99 (`ROADMAP.md`), which was set for a single-user, bring-your-own-key app. The charter
  now describes a working team member.

Limits of the evidence:

- This is a judgment. No willingness-to-pay data or customer interview was found. The amount may be low for a team
  product.
- Cloud meeting tools charge per seat. Vendor-page list prices billed monthly, fetched 2026-11-25: Otter Pro $16.99
  and Business $30, Fireflies Pro $18 and Business $29, Granola Business $14, Claude Team standard seat $25. Annual
  billing is lower for Otter, Fireflies and Claude. These products are not like for like. Source: task #22755's
  `docs/market/competitor-prices.md`, which was untracked and unmerged in
  `C:\Source\softboss-worktrees\Meeteor.task-22755` when read. Claude Meetings, Fathom, Microsoft Facilitator and
  AgentCall prices are unverified.
- The findings of the earlier market scans (#17667, #22652) were not found in this repository and are not used here.

## Avatar: not required for the first sale

Offer it later as a differentiator. It stays a product pillar; this changes only its timing.

- The charter's current focus is to prove the working-member loop "fully local, before the avatar".
- The owner's 2026-11-13 market scan, recorded in the charter, found no evidence of demand for avatars.
- Avatomic, which the avatar is built on, was paused in softBoss as of 2026-11-13.
- The first sale should not advertise an avatar. The presence orb in `index.html` is not the Avatomic avatar.

## Before anyone can be charged

Approving a price does not make the product ready to sell:

1. **A paid customer cannot activate the desktop app.** Checkout calls `generateLicenseKey`, which makes an HMAC
   `MEETINTEL-` key. The desktop app accepts only an Ed25519 `MEETINTEL2-` key. On 2026-11-25 both functions were
   run from `server.js` (lifetime and annual): `verifyLicenseV2` rejected both keys. Fixing this includes deciding
   where the private signing key is held, which `ROADMAP.md` leaves with the owner.
2. `landing.html` promises "Lifetime updates included" and "All current & future features". If approved, this becomes
   1 year of updates. It also asks for a Claude API key only, while the charter requires a choice of backend.
3. The charter's working-member loop still has to work in real meetings. This record does not assess it.
4. The LM Studio backend is not built, so a customer cannot yet supply a local model. It is required before the first
   sale: see [local-ai-backend-pre-sale.md](local-ai-backend-pre-sale.md) (task #22753).

## How to check

- Prices in the code: search `unit_amount` in `server.js` and `pricing-price` in `landing.html`.
- Licence mismatch: compare the key prefix in `generateLicenseKey` with the pattern in `verifyLicenseV2`.
