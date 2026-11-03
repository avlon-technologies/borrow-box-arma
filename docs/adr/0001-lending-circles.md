# ADR 0001: Lending circles

- **Status:** accepted
- **Date:** 2026-11-03
- **Context of change:** BorrowBox V1 had one open community. Friends now want circles. They create a circle, invite members and contribute items, and each item is either for everybody or for circle members only. Membership changes must not invalidate existing reservations. Removing a member must prevent new circle-only requests while preserving legitimate prior commitments.

## Decision

### 1. Access is a gate on *asking*, not on *having*

There is one rule: **circle membership is checked when someone asks to borrow, and never again after that.** Once a loan row exists (requested, approved, ready, borrowed, returning), every later step is authorized only by who the person is on that loan: owner or borrower. That was already how V1 worked, so none of the loan state machine, triggers or tests had to change.

This one rule covers every membership change the same way:

| Change | New circle-only requests | Pending requests | Reservations and loans |
|---|---|---|---|
| Member leaves | refused | stay; the owner decides | carry on unchanged |
| Organizer removes a member | refused | stay; the owner decides | carry on unchanged |
| Owner limits an item to circles | refused for non-members | stay; the owner decides | carry on unchanged |
| Owner takes an item off a shelf | refused if it was the item's last circle | stay; the owner decides | carry on unchanged |
| Owner hides an item (V1) | refused | stay; the owner decides | carry on unchanged |

The last row is the V1 rule for hiding. Circles reuse the same idea, so people only have to learn it once: *changing who can ask doesn't undo what's already been asked or agreed*.

**Pending requests are kept (alternative considered: auto-decline them).** A pending request was legitimate when it was made, and nothing has been promised yet. Auto-declining it would take the decision away from the owner and could hand a borrower a "Not this time" that nobody chose to send. The owner sees a note ("Priya asked through Riverside Makers and has since been removed from the circle…") and decides. Extensions on existing loans are allowed for the same reason. They are part of an existing commitment, and the owner approves them, with the usual conflict re-check.

### 2. Every loan records how it came about

`loans.via_circle_id` holds the circle whose membership let the borrower ask. It is NULL for items open to everyone, and a trigger (`loans_via_fixed`) makes it immutable. The loan page can therefore always say "Shared through Riverside Makers", and when relevant it adds "you left the circle on Nov 1; this was arranged while you were a member, so it carries on as agreed". The how and when of leaving come from the append-only circle history, not from the current membership row. This answers "was this commitment legitimate?" from the record itself.

### 3. Audience and shelves are separate

- `item_circles(item_id, circle_id)` lists which circles' shelves an item is on (many to many).
- `items.audience` is `'everyone' | 'circles'` and says who may ask.

An item open to everyone can still sit on a circle's shelf ("here's what our group has"). A circle-only item can be asked for by active members of **any** circle it is shared with. The owner sees all of an item's circles. Other people only see the circles they belong to, so circle names never leak to outsiders.

### 4. Membership is one row plus an append-only history

`circle_members` holds one row per (circle, person) with the *current* status:

```
invited ──accept──▶ active ──leave──▶ left
  │                   └──remove (organizer)──▶ removed
  ├─decline─▶ declined
  └─withdraw (inviter or organizer)─▶ withdrawn
declined / withdrawn / left / removed ──invite again──▶ invited
```

`circle_events` records every invitation, join, departure, removal, organizer change and shelf change, and it is append-only (triggers refuse UPDATE and DELETE), matching `loan_events`. People join only by accepting an invitation, so nobody is added to a group without agreeing.

Roles: **any member can invite**, which suits a friends' circle and its trust-without-bureaucracy feel. **Organizers** edit the circle, remove members and make others organizers. The last organizer can't leave while others remain, so a circle is never left without someone looking after it.

When someone's membership ends, their items leave that circle's shelf, and each removal is recorded. If one of those items was circle-only and is now on no shelf at all, nobody new can ask for it. The owner sees a warning with a link to change the sharing, and the removal preview warns about this in advance.

### 5. Enforcement in depth, the same way as V1

1. **Domain** (`server/domain/sharing.ts`, the only place these rules live). `borrowAccess()` is called inside the `BEGIN IMMEDIATE` transaction that inserts the loan. A removal running at the same moment is serialized either fully before or fully after the request, never in between.
2. **Database guards** (`server/migrations/002-circles.sql`):
   - `loans_circle_access` refuses inserting a loan on a circle-only item unless the borrower is an active member of the recorded circle and the item is on that circle's shelf. It fires on INSERT only, so existing loans can never be blocked by a later membership change.
   - `item_circles_owner_is_member` checks that only members can share with a circle.
   - `circle_members_legal_transition` keeps membership changes to the lifecycle above.
   - `circle_members_end_withdraws_items` takes a departed member's items off the shelf, as a backstop.
   - `loans_via_fixed` keeps a loan's origin unchanged, and append-only triggers protect `circle_events`.
3. **UI**: every screen states the consequences before the action. Removing someone or leaving shows a preview from `GET /api/circles/:id/members/:userId/impact`: "What stays the same" (their bookings and requests, and other people's bookings of their items) and "What changes".

### 6. Schema migrations

V1 created its schema with idempotent `CREATE … IF NOT EXISTS` statements. Adding columns needs real migrations, so `server/db.ts` now runs `schema.sql` (the V1 baseline) followed by numbered migrations tracked in `PRAGMA user_version`. The migration step takes the write lock first and re-checks the version, which is safe when several processes open the database at once. A V1 database upgrades in place: items become `audience = 'everyone'` and old loans keep `via_circle_id = NULL`. A test covers this.

## Consequences

- Existing behaviour is unchanged for anyone who never uses circles: all 36 V1 tests and 9 browser journeys still pass. Two tests needed small fixes, one for new seed data and one for a time-of-day assumption. See IMPLEMENTATION-RESULTS.md.
- Item visibility now depends on the viewer, so the catalog query has a membership `EXISTS` clause. That is fine at community scale. A large deployment would want an index-backed visibility table.
- A removed member keeps seeing items they have loans on, because they're party to those loans. They can no longer see the circle page or its other circle-only items.
- Not built: circle deletion or archiving, invite links for people outside the community (the demo picker is the identity system), per-circle borrowing rules, and notifications beyond the in-app badge.
