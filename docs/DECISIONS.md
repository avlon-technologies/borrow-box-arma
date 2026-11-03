# BorrowBox: decisions and rules

These are the product and engineering decisions made while building V1, and why. If you're extending BorrowBox, start here.

## Product principles in practice

| Principle (from VISION) | How it shows up |
|---|---|
| People before records | Lists show the item, the person and a sentence ("Sam would like it Nov 8 – 11"), never a raw status. Statuses are translated in one place (`web/src/loanCopy.ts`). |
| Every screen makes the next action obvious | Each loan page leads with a **next-step card**: a headline, one line of context, and only the actions this person can take now. The server computes the actions, including why one is blocked. |
| Trust without bureaucracy | Condition notes are optional at pickup and quick (choose a chip, add text or photos). They're only required when starting a return or confirming one, where they matter most. |
| Calm, human language | Overdue reads "This was due back 2 days ago. No stress — life happens." Declines read "Not this time". Errors explain what to do next. |
| Handle real life | The owner can confirm a return the borrower forgot to start. Overdue loans can be extended or returned. Dates that pass without a pickup are named plainly, with an action offered. Either side can cancel a reservation before pickup. People can add follow-up notes after the return. |

## Loan lifecycle

```
requested ──approve──▶ approved ──mark ready──▶ ready ──pickup──▶ borrowed ──start return──▶ returning ──confirm──▶ returned
    │                     │                       │                   └──────────owner confirms directly──────────────▲
    ├─decline─▶ declined  └─cancel─▶ cancelled ◀──┘
    └─cancel (borrower)─▶ cancelled
```

| Action | Who | Allowed from |
|---|---|---|
| request | anyone except the owner; the item must not be hidden | — |
| approve / decline | owner | requested (approve also needs no overlapping confirmed booking and end date ≥ today) |
| cancel | borrower: requested, approved, ready · owner: approved, ready | |
| mark ready (+ optional "before" condition) | owner | approved |
| confirm pickup (+ optional condition) | borrower | ready, end date ≥ today |
| start return (condition required) | borrower | borrowed |
| confirm return (condition required, agree/differ) | owner | borrowed or returning |
| follow-up condition note | either | returning, returned |
| propose extension | borrower | approved, ready, borrowed (overdue included) |
| accept / decline extension | owner | pending extension |
| withdraw extension | borrower | pending extension |
| message | either | any |

The `loans_legal_transition` trigger enforces the same transition graph at the database level.

## Conflicts and concurrency

- Pending requests may overlap freely. People can't request dates that overlap an already-confirmed booking, because the calendar shows those as booked.
- A **holding** loan is one that is approved, ready, borrowed or returning. Two holding loans for the same item can never overlap. This rule is enforced in three places:
  1. The domain check inside a `BEGIN IMMEDIATE` transaction gives a friendly message naming the conflicting booking.
  2. The SQLite triggers `loans_no_overlap_insert` and `loans_no_overlap_update` are the final guard, even against code that skips the domain check.
  3. The UI disables the button in advance and shows the server's reason.
- Extension acceptance re-checks for conflicts, because a booking may have been approved since the extension was proposed. It also refuses if the due date changed since then (a stale proposal).
- Tested with an in-process HTTP race and with **separate OS processes** racing on one database file (`tests/conflicts.test.ts`).

## Evidence never overwritten

- Each condition report is its own row with an author, role (owner or borrower), phase (handoff, return or followup), condition, notes and photos. When the owner confirms a return they record whether they agree with the borrower. A disagreement marks the loan *disputed*, and both accounts appear side by side.
- `condition_reports`, `report_photos`, `loan_events` and `messages` are append-only: triggers reject any `UPDATE` or `DELETE`. To respond to a dispute, you add a follow-up note.
- `loan_events` is the attributable audit trail. It records who did what and when, including system events such as closing an extension when a loan ends.

## Double submission and refresh

- The client sends an `Idempotency-Key` with every write. The server stores successful responses per (user, key) and replays them. A key is reused only while retrying the same intent, and a new one is minted after success or after a rule rejects the request.
- Duplicate requests from the same person for overlapping dates are refused even without a key.
- All state lives on the server. Pages refetch when the tab regains focus, so a second person's tab catches up when you switch to it.

## Identity

V1 uses a **demo person picker** instead of passwords. The vision asks for seeded identity switching, and evaluators need two accounts quickly. Choosing a person creates a server-side session token. The token is stored per browser tab (sessionStorage, with localStorage as the default for new tabs) and sent as a Bearer header, so two tabs can be two people. Every API call is authorized server-side against that session. Swapping the picker for real authentication would only touch `POST /api/session`.

## Hiding

Hiding sets `items.hidden`. The item leaves the catalog and new requests are refused (`409 item_hidden`). Existing requests, reservations and loans carry on untouched. The owner can still approve requests that were already pending. Anyone with a loan on the item can still open its page. Others see a gentle "This item is resting" message.

## Lending circles

The full reasoning is in [adr/0001-lending-circles.md](adr/0001-lending-circles.md). In short:

- A **circle** is a small group with a shared shelf. You join by accepting an invitation. Any member can invite. Organizers edit the circle, remove members and make others organizers. The last organizer must hand over before leaving.
- Each item has an **audience**: *anyone* (V1 behaviour) or *circle members only*. Separately, it can sit on any number of its owner's circles' shelves.
- **Access is checked when someone asks, never afterwards.** Leaving, being removed, an item being limited to circles, or an item coming off a shelf all stop *new* requests. Pending requests stay with the owner to decide. Reservations and loans carry on untouched. This is the same rule as hiding.
- Each loan records the circle that let the borrower ask (`via_circle_id`, which never changes). Loan pages show it, and explain when the borrower has since left.
- The rule is enforced in the domain (`server/domain/sharing.ts`, inside the request's write transaction), by triggers (`loans_circle_access` and others in `server/migrations/002-circles.sql`), and in the UI. Removing someone or leaving shows a preview of what stays the same and what changes.
- Circle history (`circle_events`) is append-only, like loan history.

| Circle action | Who |
|---|---|
| create | anyone (becomes organizer) |
| invite | any active member |
| withdraw invitation | whoever sent it, or an organizer |
| accept / decline | the invited person |
| edit name, description, colour | organizers |
| remove a member, make organizer | organizers |
| leave | any member (the last organizer hands over first, unless alone) |
| share or unshare an item | the item's owner, while an active member |

## Schema changes

`server/schema.sql` is the V1 baseline. Later changes are numbered files in `server/migrations/`, applied in order by `server/db.ts` and tracked with `PRAGMA user_version`, so existing databases upgrade in place. To change the schema, add a new migration file and append it to `MIGRATIONS`. Never edit a migration that has already shipped.

## Photos

The browser shrinks photos to at most 1600px (JPEG) before upload, and the raw bytes are POSTed to `/api/uploads`. The server checks the file's magic bytes (JPEG, PNG, WebP or GIF), limits size to 6 MB, stores the file under `data/uploads/`, and records who uploaded it. Items and reports can only use uploads that belong to the person submitting them.

## Stack choices

- **Node 24 with built-in `node:sqlite` and native TypeScript stripping.** There's no native build step, so a clean start is just `npm install`. SQLite in WAL mode with `busy_timeout` provides real persistence and serialized writes.
- **Express 5 + zod** keep the HTTP layer thin. All rules live in `server/domain/`.
- **React + Vite**, hand-written CSS design tokens, and self-hosted fonts (Fraunces + Inter) so the app works offline. Icons are lucide.
- **Vitest + supertest** cover rules and concurrency. **Playwright** covers real two-person browser journeys, keyboard use and phone layout.

## Assumptions

- A community is one time zone (configurable). Multi-zone communities would need a per-community setting.
- A loan's length limit (`max_days`) applies to requests. Extensions may go past it, because the owner explicitly agrees to them.
- Requests can be made up to a year ahead.
- There is no item deletion in V1. Hiding is the humane equivalent, and it keeps history intact.
- Circles are drawn from the existing community of people. With the demo person picker there is no one outside it to invite, so invite links aren't needed yet.
- An item's audience is the same for every circle it's on. Per-circle rules, such as "open to Riverside, closed to Harbour", weren't asked for, and they would make "who can borrow this?" harder to answer at a glance.
- Circles can't be deleted. When the last member leaves, the circle simply has no one in it, and its history is kept.
