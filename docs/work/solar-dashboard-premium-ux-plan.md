# Solar Dashboard — Premium UX Work Plan

Companion to the read-only audit at `docs/solar-dashboard-audit.md`
(referenced in this document as "the audit"). This is work stream 2 of
3. Stream 1 (visual & design) is shipped (`f9c6c01`); stream 3 (payment-
path hardening) is tracked separately.

This document is a checklist Ty works through across multiple sessions.
Each item should be small enough to land in one sitting.

## 1. Goals

- A user who pays never sees the premium UI flicker back to free during
  a wallet switch — `isPremium` reflects the session, not transient
  wallet state.
- Within a paid 30-minute session, premium data feels live, not frozen
  on the moment of purchase.
- The "$X monthly potential" number is *one* number computed *one* way;
  a returning user with the same data sees the same value.
- Keyboard and screen-reader users can dismiss `PaymentGate` without
  reaching for a mouse.
- A user paying on Base mainnet sees "Base", not "Base Sepolia" — chain
  labels never quietly lie.

## 2. Behavioral Principles

- **Payment buys a session, not a transaction.** Once paid, every
  surface inside the session feels like part of the same purchase. No
  flicker, no silent reset, no "did that actually go through?"
- **Gated features should always communicate *what's behind the gate*.**
  Stream 1 shipped the lock-card pattern for this — premium UX honors
  it by making the unlock moment visible too.
- **Premium consistency over premium optimism.** If two formulas give
  different "monthly potential" numbers, the user picks one and we
  honor it; we don't ship both and let data availability dictate which
  the user sees.
- **The wallet is an input, not the identity.** A switch from wallet A
  to wallet B is a user action, not a session boundary. Don't tear
  down state that wasn't tied to the wallet.
- **Modals are keyboard-accessible by default.** Esc closes, Tab is
  trapped, focus moves on open. Non-negotiable, regardless of how
  pretty the modal looks.
- **Surface the session, not the transaction.** Tx hashes are
  cryptographic receipts; users care about session state ("am I
  premium right now? for how long?"). Lead with that.

## 3. Work Items — Checklist Format

Group order is not execution order — see section 7 for sequencing.

### 3.1 Session freshness & refresh cadence

- [ ] **Decide and implement premium auto-refresh cadence**
      File: `src/hooks/usePremiumSolarData.ts:159`
      What: Currently `refreshInterval: isPremium ? 0 : 300000` —
      premium tier never auto-refreshes. Pick a real cadence per OQ#3
      and apply.
      Why: A user who paid for "live" data sees a frozen number until
      they manually click refresh.
      Done when: Premium tier auto-refreshes at the cadence chosen for
      OQ#3; the cadence and rationale are documented in code.
      Risk: Each premium refresh hits the upstream Open-Meteo API
      (free-tier `bypassCache: true`). Aggressive cadence = more
      upstream load. Balance freshness vs cost.

- [ ] **Surface session expiry remaining time**
      File: `src/hooks/usePremiumSolarData.ts` + dashboard rendering
      What: Session is a 30-min HMAC token (`src/lib/x402/session.ts:5`).
      The UI shows nothing about remaining time. Add a small
      "Premium · 12m left" indicator near the TierBadge or tx-hash row.
      Updates ~once per minute.
      Why: User paid; the value of the session is invisible until it
      lapses. Communicates what they bought and helps them decide
      whether to refresh / repurchase before expiry.
      Done when: A live premium session shows remaining time somewhere
      on the dashboard. Updates without leaking timers across remounts.
      Risk: setInterval discipline (cleanup on unmount).

### 3.2 Wallet-switch handling

- [ ] **Reset `isPremium` on wallet switch (not just disconnect)**
      File: `src/hooks/usePremiumSolarData.ts:173-177`
      What: Effect resets `isPremium` only when `activeAddress` becomes
      falsy (full disconnect). On wallet switch A→B, `activeAddress`
      changes from one address to another but never falsy, so
      `isPremium` stays true. The new wallet has no session, but the
      UI claims premium until the next refetch reveals the truth.
      Why: ~5 seconds of false-positive premium UI after a wallet
      switch, then a flicker back to free.
      Done when: Effect resets `isPremium` on *any* `activeAddress`
      change (compare to previous via ref). The next fetch re-establishes
      premium if the new wallet has a session.
      Risk: Tied to OQ#2 — if the answer is "carry session across
      wallet switches", the fix needs a different shape (key the
      session on the token, not the wallet).

- [ ] **Audit `preferredChain` coherence on wallet (dis)connect**
      File: `src/hooks/useMultiChainX402.ts:19-26`
      What: `preferredChain` defaults to `'evm'` and is user-controlled.
      It doesn't update when wallets disconnect — so disconnecting
      EVM, then later reconnecting it, can revert active chain in a
      way the user didn't request.
      Why: Subtle stale state; possibly fine, possibly surprising.
      Done when: Either `preferredChain` updates to match the only
      connected chain on disconnect, OR the current behavior is
      explicitly documented as deliberate.
      Risk: Possibly a no-op. Mark for review with a manual test
      pass before deciding.

### 3.3 SWR cache coherency

- [ ] **Fix mutate-against-old-key after payment**
      File: `src/hooks/usePremiumSolarData.ts:289-294 vs 328`
      What: `setSessionToken(nextToken)` rotates the SWR key (line 122
      includes the token marker). Then `mutate(result, { revalidate:
      false })` uses the closure-captured `mutate`, which is bound to
      the *pre-rotation* key. The premium response gets injected into
      the soon-to-be-orphaned cache entry. The new key triggers a
      fresh fetch — defeating the "no extra fetch after payment"
      optimization the comment claims.
      Why: Wastes one round trip and may cause a brief "loading"
      flicker between payment-success and the new fetch arriving.
      Done when: After payment, the new SWR key is hydrated with the
      payment response without an extra fetch. Likely path: use SWR's
      global mutate API with the explicitly-constructed new key, OR
      pre-stage the key change via a layout-effect ordering.
      Risk: Touching SWR cache plumbing — easy to break the rest of
      the cache logic. Test that wallet-switch + repayment still
      hydrates correctly.

- [ ] **Tighten SWR token-marker URL strip**
      File: `src/hooks/usePremiumSolarData.ts:130-131`
      What: `.replace(/&token=[01]/g, '')` only matches single-digit
      0/1 markers. If the marker scheme ever uses 2+ digits or other
      characters, the replace silently does nothing and the marker
      leaks into the request URL.
      Why: Latent bug. Currently fine because the marker is always 0
      or 1. Becomes wrong the moment anyone widens the scheme.
      Done when: Marker stripping uses `URL`/`URLSearchParams` API or
      a regex that matches whatever the scheme actually generates
      (e.g., `/&token=[^&]*/g`). Same pass for `&session=...`.
      Risk: Trivial.

### 3.4 monthlyEstimate formula

- [ ] **Implement chosen monthlyEstimate formula** (gated on §4)
      File: `src/hooks/usePremiumSolarData.ts:185-187` and
      `src/lib/calculations/solarValue.ts:69-75, 118-119`
      What: Replace the three-formula switch with the single chosen
      formula per §4. Delete (or comment out + label) the other two.
      Why: User sees one consistent number for "monthly potential"
      regardless of data availability.
      Done when: §4's chosen option is implemented. The other two
      formulas are removed from the live path; helpers retained only
      if used by other callers.
      Risk: Touches the dollar-figure that drives upgrade intent.
      Validate that the chosen formula produces a number that matches
      Ty's intuition for the test cities (NYC / LA / Phoenix).

### 3.5 Gated-feature affordances

> Note: Stream 1 already removed the Weather Context and Direct/Diffuse
> locked stubs entirely (commit `71e1bd6`), and replaced the WeekForecast
> locked stubs with a deliberate lock-card. The remaining UX questions
> below are about the *premium-tier* surfaces and the upgrade moment.

- [ ] **"You just unlocked this" reveal moment**
      File: dashboard sections that newly appear on premium —
      Weather Context (`~294`), 7-Day Forecast premium variant
      (`sevenDayPremiumSection`), Direct/Diffuse stat (`~382`).
      What: After payment success, premium sections appear silently.
      Add a one-shot reveal animation (subtle outline pulse or "New"
      chip that fades after 3-5s) on first render of each newly-
      revealed section within a session.
      Why: Communicates the purchase landed and surfaces what's new.
      Pairs with item 3.7's auto-dismiss of the success pill — both
      end together so the post-payment state is clean.
      Done when: First payment in a session triggers a deliberate
      one-shot reveal on each premium section. Subsequent revisits
      within the session don't replay. Aligns with stream 1's
      "motion is data, not decoration" principle (this motion is
      *data* — it carries the "you got this" signal).
      Risk: Coordinate with stream 1 visual language so the reveal
      doesn't fight the new design system.

- [ ] **Coordinate the two upgrade CTAs**
      File: `src/pages/dashboard.tsx` Monthly Estimate Banner (~447)
      and the WeekForecast lock-card (`sevenDayLockCard`)
      What: Two upgrade affordances both call `upgradeToPremium`.
      Different visual weight, different copy ("Unlock Premium ·
      $0.001" vs "Unlock"). Decide the primary/secondary
      relationship.
      Why: On most viewports both render simultaneously. Mixed
      message about what the upgrade is and what it costs.
      Done when: One CTA is unambiguously primary; the other either
      reinforces (consistent copy) or hides when the primary is
      visible.
      Risk: Conversion UX surface. If analytics exist, look at
      click-through before / after.

### 3.6 Modal accessibility (PaymentGate)

- [ ] **Add Escape-to-close**
      File: `src/components/PaymentGate.tsx` + dashboard render at
      `src/pages/dashboard.tsx:124-146`
      What: Bind a `keydown` listener on the modal that calls
      `onCancel` when Escape is pressed. Suppress the listener while
      `isPending` is true (don't let users accidentally cancel a
      transaction mid-sign).
      Why: Standard modal expectation; users hit Esc to dismiss.
      Done when: Esc closes the modal except during `isPending`.
      Risk: Trivial.

- [ ] **Add focus trap**
      File: `src/components/PaymentGate.tsx`
      What: Today, focus stays where it was when the modal opened.
      Tab key escapes into the underlying dashboard. Add a focus trap
      so Tab/Shift-Tab cycle within the modal.
      Why: A11y minimum for modals; screen reader users in particular
      need focus contained.
      Done when: Tab cycles within `PaymentGate`. Focus returns to
      the trigger button on close. Implementation: prefer a small
      inline trap (~30 LOC) over a new dependency.
      Risk: Inline implementations can drift from spec; verify with
      a screen reader before declaring done.

- [ ] **Set initial focus on modal open**
      File: `src/components/PaymentGate.tsx`
      What: When modal opens, focus should land on a sensible
      element. Today: nothing focuses. Should focus the close button
      ("X") OR the "Pay" button if `signerReady` is true.
      Why: Keyboard users need to know the modal opened; default
      focus communicates "modal is active, here's the entry point."
      Done when: Modal open triggers focus to a sensible element via
      `ref` + `useEffect`.
      Risk: Trivial.

### 3.7 Network label dynamism

- [ ] **Derive PaymentGate network labels from env**
      File: `src/components/PaymentGate.tsx:127, 137`
      What: "Base Sepolia" and "Solana Devnet" are hardcoded. They
      don't update if `NEXT_PUBLIC_X402_NETWORK` flips to `base` or
      `NEXT_PUBLIC_SOLANA_NETWORK` to `solana` (mainnet). User would
      see "Base Sepolia" while paying on actual Base mainnet.
      Why: Mainnet flip is real, eventual. Quietly lying to users
      about the chain they're transacting on is bad.
      Done when: Labels derive from a small `NETWORK_LABELS` map
      keyed by env values. Map covers `base` / `base-sepolia` /
      `solana` / `solana-devnet`.
      Risk: Trivial. Verify both branches still render correct
      labels.

- [ ] **Single-wallet chain affordance**
      File: `src/components/PaymentGate.tsx:117-138`
      What: Chain toggle only renders when both wallets are connected
      (`canToggle`). Single-wallet users see a static badge for the
      auto-selected chain. They might want to switch but don't know
      it's possible.
      Why: Discoverability gap. Users with only one wallet don't
      realize they could connect another and get a choice.
      Done when: Single-wallet users see either (a) the toggle in a
      "Connect another wallet to switch" state (greyed-out other
      chain with tooltip) or (b) an inline copy line below the static
      badge mentioning the option. Pick one — don't ship both.
      Risk: Adds visual real estate inside the modal. Coordinate
      with stream 1's PaymentGate work if any.

### 3.8 Error recovery & retry

- [ ] **Add error boundary above the dashboard tree**
      File: `src/pages/dashboard.tsx` (component-level wrapper) or
      `src/pages/_app.tsx` (route-level)
      What: No error boundary anywhere in the dashboard render tree.
      A throw from `RoofAnalysis` (e.g., on malformed `roofSummary`)
      crashes the whole page.
      Why: Resilience minimum. One bad data shape shouldn't take
      down the whole route.
      Done when: A boundary catches errors in the dashboard tree,
      renders the error-banner pattern from stream 1, and offers a
      retry that resets the boundary state.
      Risk: Boundary placement matters — too high and it kills the
      whole page anyway; too low and it doesn't catch the right
      things. Place at the section level (one boundary per right-
      column section, e.g., RoofAnalysis, SunroofMap) so a single
      bad data shape downgrades that section without taking the
      hero / stats / curve down with it.

- [ ] **Decide error-banner retry behavior**
      File: `src/pages/dashboard.tsx:150-157`
      What: Stream 1 redesigned the error banner visually (icon +
      title + body) and pointed users to the existing refresh button.
      Decide whether the banner *itself* should grow a retry button
      that calls `refresh()` directly.
      Why: A user looking at an error banner wants to act from where
      they're looking, not scan back to the location card.
      Done when: Decision made and implemented. If "yes, add retry":
      banner gets an inline retry button calling `refresh`. If "no":
      leave as-is and document why in the banner JSX comment.
      Risk: Adds another action surface; coordinates with the visual
      treatment from stream 1.

### 3.9 TierBadge & PaymentStatus states

- [ ] **Auto-dismiss PaymentStatus success state**
      File: `src/components/PaymentStatus.tsx` + dashboard render at
      `src/pages/dashboard.tsx:160-171`
      What: PaymentStatus pill (pending/success/error) renders as
      long as `paymentState.isSuccess` is true. After payment success,
      it persists indefinitely (until next payment attempt or wallet
      disconnect). Auto-dismiss after ~3-5 seconds.
      Why: Success state is transient. After 5 seconds of "Payment
      successful," the pill becomes visual noise.
      Done when: Success state auto-dismisses on a timer; error
      state persists (user needs to read it); pending persists until
      resolution. Use a `useEffect` with `setTimeout` + cleanup.
      Risk: Trivial.

- [ ] **TierBadge "expiring" state**
      File: `src/components/PaymentStatus.tsx:67-83`
      What: TierBadge currently renders Live / Cached / Free. Add an
      "Expires soon" state when the live session has <5 minutes
      remaining (gated on item 3.1 "Surface session expiry").
      Why: Surfaces impending expiration so the user can decide to
      refresh / repurchase before data goes stale.
      Done when: Within 5 min of session expiry, badge renders with
      an amber accent and "Expires Xm" copy. Reverts to "Live" if a
      fresh payment renews the session.
      Risk: Coordinates with item 3.1; can't ship until session-expiry
      surfacing exists.

### 3.10 Tx hash display

- [ ] **Tx hash visibility lifecycle**
      File: `src/pages/dashboard.tsx:174-186`
      What: Tx hash row renders for the entire premium session
      (`isPremium && paymentState.txHash`). Always-visible. Pick a
      visibility model per OQ#5.
      Why: 30 minutes of "Tx: 0x..." is more visible than the user
      needs after the first acknowledgment, and may be a privacy
      concern for some users.
      Done when: Visibility model picked per OQ#5 and implemented
      (auto-collapse after first view / shortened address with
      "show full" toggle / always-visible-but-redacted / etc.).
      Risk: Trivial code change; the question is the product call.

- [ ] **Tx hash row on resumed sessions**
      File: `src/pages/dashboard.tsx:174-186` +
      `src/hooks/usePremiumSolarData.ts`
      What: When premium is established via session token (not a
      fresh payment in this tab), `paymentState.txHash` is null. The
      tx hash row only renders when both `isPremium && paymentState
      .txHash` are truthy. Resumed sessions (new tab, same
      `localStorage` token) won't show a tx hash.
      Why: Restored sessions feel different from fresh payments
      because of this missing affordance. User wants to verify what
      they paid.
      Done when: Either (a) backend returns the original txHash with
      session lookups so the row renders for resumed sessions too,
      OR (b) accept that resumed sessions don't show tx and document
      the choice. Note: option (a) requires a backend change which
      is at the edge of this stream's scope — may need to coordinate
      with stream 3.
      Risk: Coordinate with stream 3 if option (a) is chosen.

## 4. monthlyEstimate Decision Required

The hero/banner number for "Monthly potential" is currently computed by
one of three formulas, depending on what data is available:

- `usePremiumSolarData.ts:185-187` — when Google Solar returned data:
  `monthlyEstimate = Math.round(yearlySavings / 12)`
- `solarValue.ts:118-119` (`calculateWastedValueFromData`, the path the
  dashboard uses): `monthlyEstimate = todayTotal * 30 * 0.75` where
  `todayTotal` sums the day's hourly values
- `solarValue.ts:69-75` (`calculateWastedValue`, fallback): `monthlyEstimate
  = currentValue * 6 * 0.6 * 30 * 0.75`

These can produce *significantly* different numbers for the same
location on the same day. Two users with similar sun exposure see
different "potential" values depending on whether Google Solar covers
their address and whether the hourly array is populated.

This is a **product decision**, not an engineering one. Options:

### Option A — Keep the precedence (Google Solar > hourly > simple)
**Tradeoff:** most accurate per data context, but inconsistent across
visits. A user who moves their location from a covered ZIP to a
non-covered one sees the formula shift and the number jump for reasons
they can't see.

### Option B — Always use hourly extrapolation (drop Google override)
**Tradeoff:** consistent across visits and locations, but the formula
is fundamentally "this month if every day were like today." A sunny
day shows a high monthly; a cloudy day shows low. That's
weather-extrapolation, not a true monthly potential.

### Option C — Show both numbers side-by-side with different labels
**Tradeoff:** maximum honesty about the underlying data, but two
numbers compete for the user's attention. Hard to act on. Stream 1
just promoted the monthly banner as the conversion moment — splitting
it across two figures dilutes that.

### Option D (recommended) — Annual-average for Google Solar locations; monthly widget hidden when Google Solar isn't available
**The thinking:** today's hero already covers today-specific data.
Monthly should answer a *different* question: "what's a typical month
for this roof?" That's exactly what `yearlySavings / 12` computes (a
year-round average for the user's actual roof, grounded in real
imagery). For locations without Google Solar coverage, today's hourly
extrapolation isn't the same question — it's "what would this whole
month look like if every day matched today" — so the better answer
might be to *hide* the monthly widget rather than show a less-accurate
estimate dressed up as the same number.

**Tradeoff:** loses the monthly widget for users outside Google Solar's
coverage area. But it stops mixing two different questions under one
label, and it makes the monthly number stable for any returning user
whose roof has imagery. Free-tier impact: same as today (Google Solar
runs free); the widget visibility just becomes data-driven.

**Suggested decision pattern:** pick Option D unless Ty has a strong
reason to keep the widget visible everywhere. If "always show" is
required, Option B is the second-best choice (consistent within visits
even if technically less accurate).

## 5. Open Questions for Ty

1. **Session lifetime** — currently 30 min HMAC token, persisted via
   localStorage so it survives tab refreshes. Is the lifetime
   correct? Should it be longer to reduce repurchase friction
   (current $0.001 cost is low, but UX friction matters), or shorter
   so the "premium" feels more time-bounded?
2. **Wallet switch and session ownership** — when user pays from
   wallet A, then switches to wallet B mid-session: terminate
   immediately (current behavior — `activeAddress` change resets
   premium) or keep the session active until token expiry (the user
   *paid* for the session; the wallet was just the signing
   instrument)? Affects the shape of item 3.2's fix.
3. **Premium auto-refresh cadence** — current is 0 (no auto-refresh
   for premium tier). Within a 30-min paid session, what's the right
   interval? Same 5 min as free? Faster (1 min for "live" feel)?
   On-demand only with a manual refresh button? Affects item 3.1.
4. **Session expiry UI** — should users see a session timer
   ("Premium expires in 23:14")? Communicates value but may also
   create artificial urgency. Or silent until expiration?
5. **Tx hash visibility** — currently shown for the entire premium
   session. Some users may consider tx hashes leaky (correlatable
   with on-chain activity / wallet identity). Options: (a) keep
   fully visible, (b) shorten/redact with a "show full" toggle, (c)
   hide-by-default with a "show details" link, (d) auto-collapse
   after first view. Affects items 3.10.

## 6. Out of Scope (Explicit)

This stream will NOT touch:

- Visual styling, typography, color, or layout spacing — that's
  stream 1, which is shipped. Reference stream 1's visual system
  (`docs/work/solar-dashboard-visual-plan.md`) when a fix has both a
  UX-logic and visual aspect.
- The `chainFilteredFetch` wrapper that strips non-matching `accepts[]`
  before x402-fetch sees them (`usePremiumSolarData.ts:223-250`) —
  that's payment-execution machinery, stream 3.
- x402 price two-sources-of-truth (the literal `'$0.001'` in
  `irradiance.ts:80, 107` vs the `X402_PRICING` config in
  `lib/x402/config.ts:6-11`) — stream 3.
- Session token HMAC, replay guard, facilitator verify/settle
  (`lib/x402/session.ts` and `pages/api/solar/irradiance.ts`) —
  stream 3.
- Env variable naming (server `X402_RECEIVER_ADDRESS` vs client
  `NEXT_PUBLIC_X402_RECEIVER_ADDRESS`; same for Solana receiver and
  Google Maps key) — stream 3.
- The `withX402` / `withX402FreeTier` dead middleware in
  `lib/x402/middleware.ts` — stream 3.
- Backend changes to `/api/solar/irradiance` — except where item 3.10
  explicitly notes coordination with stream 3 may be needed for
  resumed-session tx visibility.

## 7. Sequence Recommendation

**Phase 1 — Real bugs and a11y minimums.** Items 3.2 (`isPremium`
reset on wallet switch), 3.3 (mutate-against-old-key), 3.7 (network
labels), 3.6 (Esc-to-close + focus trap + initial focus), 3.8 (error
boundary). These are correctness and accessibility — ship before any
UX polish so subsequent work doesn't paper over real bugs.

**Phase 2 — monthlyEstimate consistency.** Resolve §4 with Ty; ship
item 3.4. Highest-visibility number on the page; one consistent
formula matters more than any other UX polish in this plan.

**Phase 3 — Session lifecycle UX.** Items 3.1 (refresh cadence —
needs OQ#3), 3.1's session-expiry surfacing (needs OQ#4), 3.9
(TierBadge expiring + auto-dismiss success pill). Coordinated
treatment of "what does it feel like to *be* in a session?"

**Phase 4 — Conversion + reveal polish.** Items 3.5 (unlock reveal
moment + CTA coordination), 3.7 single-wallet affordance, 3.10 (tx
hash visibility — needs OQ#5), 3.8 retry-behavior decision. UX
craft for the moments that matter most.

**Phase 5 — Latent cleanups.** Items 3.2 `preferredChain` audit,
3.3 token-marker regex tightening. Defer if Phase 1-4 reveal these
are non-issues; otherwise ship as small follow-ups.
