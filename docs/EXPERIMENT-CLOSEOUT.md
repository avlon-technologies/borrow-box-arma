# Experiment closeout: BorrowBox, Arm A

**Final disposition: experiment complete, implementation preserved.** Nothing in the application was changed at closeout. Known defects are recorded below and deliberately left unfixed.

Central report: **[BorrowBox: Vision Fidelity and Architectural Evolution — Final Experiment Report](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/RESULTS.md)** (`continuum-architecture/experiments/2026-11-02-borrowbox-vision-fidelity/`).

## 1. Experiment identity and arm assignment

| | |
|---|---|
| Experiment | EXP-BORROWBOX-001: does a formal architecture practice (Continuum) help an AI agent realize a product vision and evolve it? |
| This repository | **Arm A: independent, without Continuum.** [`CLAUDE.md`](../CLAUDE.md): "This arm does not use Continuum or inspect the other arm." |
| Other arm | [borrow-box-armb](https://github.com/avlon-technologies/borrow-box-armb), Arm B, with Continuum |
| Agent | Claude Code, Opus 5.5, auto mode, Windows 11 |
| Dates | V1 on 2026-11-02 from 19:28 EST; lending circles from 22:07 EST on 2026-11-02 to 04:26 EST on 2026-11-03; closed 2026-11-03 |

## 2. Frozen product vision and acceptance criteria

[`VISION.md`](../VISION.md), [`ACCEPTANCE.md`](../ACCEPTANCE.md) and [`AGENT-RUN.md`](../AGENT-RUN.md) were committed at bootstrap (`4d38af5`, `64a1b40`, `24b9d2c`) and never modified. Their git blobs are byte-identical to Arm B's (`4ec217d0…`, `f222573e…`, `778e8540…`). Only `CLAUDE.md` differs between the arms, by design.

## 3. Initial implementation (V1)

- **Completion commit:** `a08365d`, 2026-11-02 21:38 EST.
- **Stack:** Node 24, TypeScript run natively, Express 5, zod, built-in `node:sqlite`, React 18, Vite, Vitest, Playwright.
- **Built:** all five vision journeys and acceptance criteria A01–A14.
  - Rules are enforced in domain code inside `BEGIN IMMEDIATE`, plus SQLite triggers.
  - Append-only loan events and condition reports.
  - The server returns each loan's available actions with reasons.
  - Per-loan messages, a keyboard-navigable calendar and a phone layout.
- **Details:** [`IMPLEMENTATION-RESULTS.md`](../IMPLEMENTATION-RESULTS.md) (V1 section) and [`DECISIONS.md`](DECISIONS.md).

## 4. Lending-circles evolution

- **Completion commit:** `3d8dcab`, 2026-11-03 04:26 EST.
- **Built:** circles, invitations (accept, decline, withdraw), shared shelves, per-item audience (everyone or circles), organizer roles and handover, an impact preview before removing a member or leaving, and a per-loan record of the circle it came through (`via_circle_id`, immutable).
- **Central rule:** membership is checked only when someone asks to borrow, never afterwards. Removal stops new circle-only requests. Pending requests, reservations and loans carry on, and the owner decides on pending requests.
- **Migration:** numbered migrations (`PRAGMA user_version`); a V1 database upgrades in place.
- **Design record:** [`adr/0001-lending-circles.md`](adr/0001-lending-circles.md).

## 5. Final commit and how to reproduce

- **Evaluated commit:** `3d8dcab108c01cac45c2134ec287fff11dc53550`. This closeout document was added afterwards and changes no code.
- **Run:**

  ```bash
  git checkout 3d8dcab108c01cac45c2134ec287fff11dc53550
  npm install && npm run setup && npm start      # http://localhost:5174, Node 22.18+ (24 recommended)
  npm run verify                                 # typecheck, backend tests, build, browser tests
  ```

## 6. Test and verification results

| Check | Result | Status |
|---|---|---|
| Typecheck | clean | re-run at closeout, 2026-11-03 |
| Backend tests (Vitest) | **49 / 49** | re-run at closeout |
| Browser journeys (Playwright, Edge) | **12 / 12** | re-run at closeout |
| V1 at completion | 36 backend + 9 browser | self-report |
| Independent review | rubric 8.875 / 10; blind experimenter rating 7/10 after V1, 8/10 after circles | see central report §4 |

The closeout test output is in the central repository: [`evidence/test-runs/`](https://github.com/avlon-technologies/continuum-architecture/tree/main/experiments/2026-11-02-borrowbox-vision-fidelity/evidence/test-runs).

## 7. Significant decisions

- Approval atomicity uses a write lock plus overlap triggers. Overlapping pending requests coexist and are never auto-declined.
- Evidence is append-only, enforced by triggers. Disagreement is a new attributed report plus a `disputed` flag.
- One community time zone, inclusive whole days; idempotency keys against double submission.
- Circles:
  - "Access is a gate on *asking*, not on *having*." The access check is an INSERT-only trigger, so later membership changes can never block an existing loan.
  - Pending requests survive removal; the auto-decline alternative was considered and rejected.
  - Circle history is its own append-only table with a single write path (`server/domain/sharing.ts:93`).

The central report (§5.4) compares these decisions with the ones Arm B reached through Continuum. They are almost all the same.

## 8. Known defects and limitations

Verified at closeout against this commit on a throwaway server. Full reproductions are in [DEFECTS.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/DEFECTS.md). **Not fixed.**

| ID | Defect | Root cause |
|---|---|---|
| D1 | **An overdue loan does not block a new booking.** A loan still `borrowed` past its due date stops counting for later dates. The owner can approve and mark ready another person's booking for today, and that person can confirm pickup, so two loans show the item as borrowed. | Conflict checks compare scheduled dates only (`server/domain/loans.ts:93-101`, `server/schema.sql:74-94`). `markReady` and `confirmPickup` don't check (`loans.ts:270-296`). `items.ts:186-188` already treats late loans as "out" for display. No test combines lateness with a new booking. Also present in Arm B. |
| D2 | **A past declined or cancelled request keeps an item visible.** After the owner hides an item or limits it to circles, that person can still open it: description, notes, booked dates. | `isInvolved` counts loans of any status (`server/domain/sharing.ts:79-81`), and `getItemDetail` then skips the hidden and circle checks (`items.ts:173-181`). Also present in Arm B. |

The closeout checked two Arm B defects here and found them absent:

- Bodyless requests return a consistent 415, not 500.
- Past-date extensions are refused (`loans.ts:368`).

Limitations stated by the agent: no real authentication (demo person picker), uploads public by URL, no live push between tabs, a single community time zone, no item deletion or circle archiving, and dark mode not implemented.

## 9. Agent time, interventions and cost

From the session transcripts (central report [EVIDENCE §6](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/EVIDENCE.md#6-time-interventions-and-cost)):

| | V1 | Lending circles |
|---|---|---|
| First prompt → completion commit | 2 h 10 min | 6 h 19 min |
| Self-reported | "about 2¼ hours" | "22:05 → about 03:30 EST" (≈5.5 h) |
| Human messages | 1 × "continue", after an API error | 1 unprompted note ("thyre both good"), no direction change |
| Main-session output tokens | 205,812 | 139,284 |

- **Dollar cost:** not available.
- **Corrections to the self-reports:**
  - The V1 results say "no human intervention after the initial instruction", but the transcript shows one "continue" after an API error.
  - The circles feature commit is at 04:26 EST, not about 03:30.
- **Timing caution:** both arms hit the same API outages at the same moments, so wall-clock times are not evidence of efficiency.

## 10. Links

| | |
|---|---|
| Final report | [RESULTS.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/RESULTS.md) |
| Evidence baseline | [EVIDENCE.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/EVIDENCE.md) |
| Defects | [DEFECTS.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/DEFECTS.md) |
| Arm B closeout | [borrow-box-armb/docs/EXPERIMENT-CLOSEOUT.md](https://github.com/avlon-technologies/borrow-box-armb/blob/main/docs/EXPERIMENT-CLOSEOUT.md) |
| Screenshots | [`docs/screenshots/`](screenshots/) (agent's, seeded data) · [reviewer set](https://github.com/avlon-technologies/continuum-architecture/tree/main/experiments/2026-11-02-borrowbox-vision-fidelity/evidence/screenshots/arm-a) |

## 11. Final disposition

**Experiment complete; implementation preserved.**

The application, its tests, its data and its frozen inputs are exactly as evaluated at `3d8dcab`. Defects D1 and D2 remain, on purpose, as part of the record. Any future work on this code should start from a new commit that references this closeout, not rewrite history.
