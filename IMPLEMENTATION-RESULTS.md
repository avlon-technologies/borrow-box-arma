# BorrowBox: implementation results

## Evolution 1: Lending circles

**Status:** complete. Friends can start a circle, invite people (who accept or decline), contribute items to a shared shelf, and choose for each item whether *anyone* or only *circle members* can ask for it. Leaving or being removed stops new circle-only requests. Pending requests, reservations and loans already made carry on untouched, and each loan records the circle it came through. All V1 behaviour is preserved.

- **Design record:** [docs/adr/0001-lending-circles.md](docs/adr/0001-lending-circles.md). The rules summary is in [docs/DECISIONS.md](docs/DECISIONS.md#lending-circles), and the demo steps are 10–14 in [README.md](README.md).
- **Session record:** started 2026-11-02 about 22:05 EST, finished 2026-11-03 about 03:30 EST, single autonomous session. One mid-run user message ("thyre both good") needed no change of direction. Continuum was not used, and the other repository was not inspected.

### What changed

| Layer | Change |
|---|---|
| Schema | `server/migrations/002-circles.sql` adds `circles`, `circle_members` (lifecycle-guarded), `item_circles`, append-only `circle_events`, `items.audience`, and the immutable `loans.via_circle_id`. Triggers: `loans_circle_access` (INSERT only), `item_circles_owner_is_member`, `circle_members_legal_transition`, `circle_members_end_withdraws_items`, `loans_via_fixed`. |
| Migrations | `server/db.ts` applies numbered migrations after the V1 baseline, tracked with `PRAGMA user_version` and safe across processes. Existing databases upgrade in place. |
| Domain | `server/domain/sharing.ts` is the single home of "who can see and ask for what". `server/domain/circles.ts` covers the circle and membership lifecycle, shelves, and the impact preview. `loans.requestLoan` checks access inside its write transaction and records `via_circle_id`. The catalog and item detail are filtered per viewer. |
| API | `GET/POST /api/circles`, `GET/PUT /api/circles/:id`, invitations, join, decline, leave, remove, make organizer, share and unshare items, and `GET …/members/:userId/impact`. `/api/me` adds invitation counts and your circles. Item create and edit accept `audience` and `circleIds`. `/api/items?circle=` filters by circle. |
| Web | New *Circles* tab (with an invitation badge), circle list and invitations, start/edit circle, and the circle page (shelf, members, invitations, history, removal and leave previews). Sharing section on the item form. "Who can borrow" on item pages. Circle-only tags on cards. Circle filter on Explore. "Shared through…" plus membership context on loan pages. |
| Seed | Two circles. *Riverside Makers* (Maya, Sam, Priya) has a circle-only sewing machine reserved by Priya and a game box Theo booked before leaving. *Harbour Lane Street Party* (Theo, Sam) has a pending invitation for Maya. |

### Evidence (all run in this session, Windows 11, Node 24.22.1)

| Check | Result |
|---|---|
| `npm run verify` (typecheck → backend tests → build → browser journeys) | **exit 0** |
| Backend tests | **49 passed** (4 files): the 36 V1 tests plus 13 new ones in `tests/circles.test.ts` |
| Browser journeys | **12 passed**: the 9 V1 journeys plus 3 new ones in `e2e/circles.spec.ts` |
| Upgrade of the real V1 database | A copy of `data/borrowbox.db` (user_version 0, 13 loans) opened with the new code → user_version 1, the same 13 loans with the same statuses, all items `audience = everyone` |
| Visual review | Desktop and 390 px screenshots reviewed. Fixes made: member actions crowding names, a mobile invitation card overflowing, possessives ("Makers’"), and date precision. New screenshots are in `docs/screenshots/` (`circle.png`, `circle-remove-preview.png`, `loan-after-leaving.png`, `item-sharing.png`, `m-circles.png`). |

**What the new tests cover**

- *Lifecycle:* create with invitations; accept, decline, withdraw and re-invite; the exact attributed event history; the last organizer must hand over before leaving; a departing member's items leave the shelf.
- *Authorization:* former members get `404 not_a_member`. Non-organizers can't remove, promote or edit. Only owners share their own items, and only with circles they're in. The impact preview is organizer-or-self only.
- *Visibility and access:* circle-only items are absent from outsiders' catalogs and item pages (`item_circle_only`) and refused on request (`403 circle_only`). Open items on a shelf stay public. Circle names don't leak. Circles-only needs at least one circle. Edits that leave out the sharing fields keep the current sharing.
- *Commitments preserved:* after removal, the member's approved reservation runs its full course (ready → pickup → extension accepted → return → confirmed). Their pending request stays for the owner to approve. New circle-only requests are refused. The seeded member who left can still see their booking through. Limiting an item to circles leaves an outsider's pending request approvable. Rejoining restores access.
- *Database guards:* circle-only inserts without a valid membership, changing `via_circle_id`, sharing by a non-member, illegal membership transitions, and edits to circle history are all refused by triggers.
- *Concurrency:* separate OS processes fire five requests spread around a removal by a sixth process. Requests well before it succeed, requests well after are refused as `circle_only`, there is no other kind of failure, and every request that got in is still present and unchanged afterwards. While building this test I found the first version always let the removal win (no real interleaving), so I staggered the timings and checked it was stable over 4 consecutive runs.
- *Migration:* a database built from the V1 schema with V1 data upgrades in place, and the old loan can still be approved.

**Browser journeys added:** (1) Sam starts a circle and invites Theo, then puts the backpack on the shelf as circle-only. Priya (outsider) no longer finds it, but her existing reservation stands. Theo sees the badge, joins and can ask for it. (2) Maya removes Priya after reading the impact preview. Priya's reservation still says Reserved and explains why. Priya can't ask again and the circle is gone from her list. Maya invites her back, she rejoins and re-shares her game box. (3) Circle pages on a 390 px phone have no sideways scroll.

### Changes to existing tests (and why)

- `tests/conflicts.test.ts` idempotency test: switched from the board-game box to the telescope. The new seed gives the game box a booking on the dates the test used. The assertions are unchanged.
- `e2e/journeys.spec.ts` "two tabs" test: it looked for the text "Good…" (morning/afternoon/evening), which fails between midnight and 5 am, when the greeting is "Hello". It now checks the greeting element itself. This was an existing flake that showed up because the run crossed midnight.

### Also fixed along the way

- The seed stamped "member since" with the real clock instead of the story clock (it showed "Member since November 2026").
- Availability copy read "Free until in 2 days". It now reads "Free for 2 days" / "Free today · booked tomorrow".

### Known gaps for circles

- No circle deletion or archiving. A circle whose last member leaves just sits empty, with its history kept.
- No invite links for people outside the community. Identity is still the demo person picker.
- One audience per item, not per circle.
- Invitations appear as an in-app badge only (no email or push, consistent with V1).
- The catalog visibility check is a per-row `EXISTS`. That's fine at community scale; a large deployment would want a precomputed visibility index.

---

# V1 results

**Status:** complete against VISION.md and ACCEPTANCE.md. All required journeys run end to end in a real browser, between two people, on a persistent database. Known gaps are listed at the bottom.

- **Run:** `npm install && npm run setup && npm start` → http://localhost:5174 (Node 22.18+, Node 24 recommended). Full demo script in [README.md](README.md).
- **Stack:** Node 24 (native TypeScript, built-in `node:sqlite`), Express 5, zod, React 18, Vite, Vitest, Playwright.
- **Session record:** started 2026-11-02 19:31 EST, finished about 21:45 EST (~2¼ hours wall clock), single autonomous session. No human intervention after the initial instruction. One background helper agent sourced openly licensed photos. Continuum was not used, per the arm rules, and the other repository was not inspected.

## Evidence

All of the following were **actually run** in this session (Windows 11, Node 24.22.1):

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean |
| Backend tests | `npm test` | **36 passed** (3 files) |
| Production build | `npm run build` | built |
| Browser journeys | `npm run test:e2e` (Edge via Playwright, throwaway DB) | **9 passed** |
| Everything together | `npm run verify` | exit 0 |
| Fresh clone | `git clone` → `npm install` → `npm run setup` → start | served `/` 200, seed photo 200, 4 people listed |
| Restart persistence | create a request over HTTP, kill the server, start it again | request still `requested` with its note; session token still valid |

The final `npm run verify` ran after the last code change (a calendar hover-colour fix and a friendlier `npm run seed` message when the server is running). It exited 0 with typecheck clean, 36/36 backend tests passing, a successful build, and 9/9 browser journeys passing.

### What the tests cover

**Backend (`tests/`)**
- *Authorization:* self-borrowing rejected (403). A borrower can't approve, mark ready or confirm a return. An owner can't confirm pickup or start a return. Strangers get 404 on loans. Only owners can edit or hide items. Every endpoint requires a session. Uploads can't be attached by someone else.
- *State transitions:* double approve → 409. Decline, then approve or cancel → 409. Owner can't cancel a pending request (decline instead). Can't cancel after pickup. The database trigger refuses illegal status jumps and changes to who is on a loan.
- *Conflicts and concurrency:* overlapping pending requests are allowed. Approving one blocks the other, with a reason. A cancellation frees the dates. Three concurrent HTTP approvals → exactly one 200. **Six separate OS processes** racing approvals on one SQLite file → exactly one approved. A racing extension acceptance vs. a conflicting approval → exactly one wins. A direct SQL second overlapping approval is rejected by the trigger.
- *Extensions:* propose and accept moves the due date and keeps the original. A conflicting proposal is refused and suggests the latest possible date. Acceptance re-checks conflicts that appeared later. Decline is recorded. Withdraw works. Overdue loans can be extended. Only one pending extension at a time.
- *Evidence:* full journey checks the exact attributed event sequence and four separate condition reports. Disagreement sets `disputed`. A follow-up is appended without changing earlier notes. UPDATE and DELETE on evidence or history are rejected by triggers.
- *Overdue / time zone:* the seeded loan is 2 days late and still returnable. At 23:30 Toronto on the due date it is not late; at 00:30 the next day it is. "Today" is computed in the community zone.
- *Hidden items:* not in the catalog, new requests get 409, the existing reservation is kept and can proceed, showing the item again reopens requests.
- *Double submission:* two simultaneous POSTs with the same Idempotency-Key → one loan, identical responses. A double-clicked approval → one event.
- *Persistence and seed:* reopening the DB file keeps data. Seeding twice is a no-op. Two fresh seeds are identical (4 people, 14 items, 7 categories, loans in 6 states).

**Browser (`e2e/journeys.spec.ts`)**
1. Sam searches, requests with a note, and the request persists after refresh. Priya approves and marks it ready with condition notes. Sam picks it up and returns it with notes and a **real photo upload**. Priya confirms with a *differing* account. Both accounts and the full attributed history are visible.
2. Overlapping tent requests: approve one, the other's Approve is disabled with an explanation, decline with a note, and the borrower sees "Not this time".
3. Extension: a conflicting date gets a suggestion, which the borrower applies. The owner accepts, the due date shows "extended from", and history records it.
4. Overdue indicator, then return.
5. Hidden item: absent from the catalog, a direct link shows "resting", the existing reservation is visible to the borrower, and hide/show from the item page works.
6. Owner lists an item with a photo, edits it, and can't request their own item.
7. **Keyboard only:** sign in by Tab/Enter, pick dates with arrow keys, send a request.
8. **Phone (390px):** bottom navigation works, no horizontal overflow on four pages.
9. Two tabs can be two different people.

Screenshots: [docs/screenshots](docs/screenshots) (desktop catalog, item with date selection, owner request decision, disputed return, mobile overdue loan, mobile lending).

## Acceptance mapping

| ID | How it's met |
|---|---|
| A01 | Photo-led catalog with search (title, description, category, owner), category chips and "Available today". Item page shows owner, rules and an availability calendar. |
| A02 | Person picker plus switcher. Each tab can be a different person. Requests persist (e2e 1). |
| A03 | Approve, decline (with note) and cancel. Invalid transitions return 409 with human messages, enforced in the domain and by a trigger. |
| A04 | Pending overlaps allowed. Approval is atomic (`BEGIN IMMEDIATE` + overlap triggers), proven by multi-process tests. |
| A05 | Server-side checks on every action. Self-borrow is 403. See the authorization tests. |
| A06 | Ready → pickup → return → completion, with an append-only `loan_events` audit trail shown as History. |
| A07 | Separate attributed condition reports at handoff, return and follow-up, with photos and an agree/differ flag. Disputes are preserved side by side. |
| A08 | Borrower proposes, owner accepts or declines. Conflict checks at proposal and again at acceptance (also in a racing test). |
| A09 | "N days late" indicators in lists, the loan header and the next-step card. Overdue loans stay returnable and extendable. |
| A10 | `hidden` blocks new requests only. Reservations continue (tests and e2e). |
| A11 | SQLite file in `data/`. Restart check passed. `npm run seed` resets the demo deterministically, with dates relative to today. |
| A12 | Keyboard-navigable calendar (roving tabindex, arrow keys, PageUp/PageDown), skip link, focus moves to main content on navigation, visible focus rings, `aria-live` toasts, `role=alert` errors, labelled controls, reduced-motion support, mobile bottom nav, 44px touch targets. Keyboard and phone e2e tests. |
| A13 | 36 backend + 9 browser tests, executed as shown above. |
| A14 | README with a demo script, `docs/DECISIONS.md`, this file. Every button in the UI is wired to a working flow. |

## Notable decisions

Full detail is in [docs/DECISIONS.md](docs/DECISIONS.md).

- The server returns each loan's **available actions with reasons**, so the UI never offers a dead button and explains blocked ones ("Overlaps Priya's booking (Nov 7 – 10)").
- After approving one of several overlapping requests, the owner sees "Others are still waiting on these dates", with links to decline them kindly. I added this after an e2e test showed the competing request otherwise disappeared from view.
- A per-loan message thread makes it possible to coordinate the handoff, as the vision asks.
- The owner can confirm a return the borrower forgot to start. A pickup missed past its dates is named plainly rather than shown as a status.
- Photos: the seed uses real openly licensed photos (credited in-app). A few seed items were renamed to match the available photos (waffle iron, cargo trailer, garden party set, step ladder).

## Known gaps and limitations

- **No real authentication.** Identity is a demo picker by design (seeded identity switching), but anyone who can reach the server can act as anyone. Sessions don't expire. Don't expose it publicly as-is.
- **Uploaded photos are public by URL.** They're served under unguessable UUID paths with no auth check, which is acceptable for a demo community.
- **No live push between tabs.** Pages refresh when you switch back to a tab (focus/visibility), not in real time.
- **One community time zone.** It's configurable but global.
- **No item deletion.** Hiding is the supported way to retire an item, and it preserves history.
- **No rate limiting, and no cleanup of orphaned uploads.**
- **E2E browser:** the suite uses Microsoft Edge on Windows by default. On other platforms run `npx playwright install chromium` first. The e2e suite was only run on Windows.
- **npm notice:** npm 11 prints a notice that esbuild's install script wasn't run. It's harmless; the build works without it.
- Dark mode was not implemented.
