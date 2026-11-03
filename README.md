# BorrowBox

A warm, trustworthy lending library for friends and small communities. List the things you're happy to lend, browse what neighbours share, ask for dates, and coordinate the handoff, use and return. Every screen tells you the next step.

![Stack: Node 24 · Express · SQLite (built-in) · React · Vite](https://img.shields.io/badge/stack-Node%2024%20%C2%B7%20SQLite%20%C2%B7%20React-c4553a)

## Quick start

Requires **Node.js 22.18+ (Node 24 recommended)**. Node runs the TypeScript server directly and includes SQLite, so there are no native modules to compile and no database to install.

```bash
npm install
npm run setup     # builds the web app and seeds the demo community (data/)
npm start         # → http://localhost:5174
```

Open http://localhost:5174 and pick a person. That's it.

| Command | What it does |
|---|---|
| `npm start` | Serves the app and API on port 5174 (`PORT` to change). Seeds automatically if the database is empty. |
| `npm run seed` | **Resets** the demo: wipes `data/` and reseeds. Dates are relative to today, so the demo always looks current. |
| `npm run build` | Rebuilds the web app into `dist/`. |
| `npm run dev` + `npm run dev:web` | Development: API with auto-restart, plus Vite with hot reload on http://localhost:5173. |
| `npm test` | Backend tests (Vitest): rules, authorization, state transitions, concurrency, persistence. |
| `npm run test:e2e` | Browser journeys (Playwright). Needs a build first. Runs on its own throwaway database. |
| `npm run verify` | Typecheck, backend tests, build, then browser tests. |

The e2e tests use Microsoft Edge on Windows. Elsewhere, run `npx playwright install chromium` once (or set `PW_CHANNEL=chromium`).

Environment: `PORT` (default 5174), `BORROWBOX_DATA_DIR` (default `./data`), `COMMUNITY_TIME_ZONE` (default `America/Toronto`).

## A 10-minute demo with two people

**Each browser tab can be a different person.** Open two tabs, choose **Sam** in one and **Maya** in the other, and switch at any time from the avatar menu (top right). Your identity survives a refresh.

The seeded community (4 people, 14 items, 13 loans in different states) is set up so that every journey can be tried right away:

1. **Browse and search** (anyone): Explore shows the catalog. Search "tent" or a neighbour's name, filter by category or "Available today", and open an item to see its owner, rules and availability calendar.
2. **Request → approve** (Sam, then Priya): as Sam, open *Tabletop telescope*, pick dates on the calendar, add a note and send. Refresh: the request is still waiting. Switch to Priya → *Lending* → approve or decline.
3. **Conflicting requests** (Sam): *Lending* shows two overlapping requests for the *Four-person camping tent* (Priya and Maya). Approve one. The other then shows why it can't be approved too, and offers a kind decline. The server enforces this even under concurrent clicks.
4. **Handoff and return** (Maya and Sam): Maya's *Inflatable paddleboard* is ready for pickup, so as Maya choose "I've picked it up". Sam's *Wooden step ladder* return is in progress, so as Maya choose "Confirm it's back" and either agree with Sam's condition notes or record a different view. Both accounts are kept.
5. **Disagreement history** (Maya or Priya): the past *Sewing machine* loan shows the borrower's and owner's condition notes side by side, plus a follow-up.
6. **Overdue** (Sam): the *Cordless drill* is 2 days late. You'll see a gentle indicator, and the drill can still be returned or extended.
7. **Extensions** (Maya, then Priya; Sam): Maya has Priya's *Portable movie projector*, and Theo has it booked right after. Asking for too long a stretch suggests the latest possible date. Priya accepts and the due date moves. As Sam, Theo's pending extension on the *Bike cargo trailer* is waiting for your answer.
8. **Hide an item** (Theo): the *Pressure washer* is hidden. It's missing from the catalog and refuses new requests, but Priya's reservation still stands. Owners can hide or show any item from its page.
9. **List and edit** (anyone): *Share something* adds an item with a photo and borrowing rules. Use *Edit* on your own item's page.

## How it's built

```
server/            Express API + domain rules (TypeScript, run directly by Node)
  schema.sql       tables and the integrity guards (triggers)
  domain/          items, loans (state machine, extensions, evidence), users
  app.ts           HTTP layer: auth, idempotency, uploads, errors
  seed.ts          demo community, created through the real domain functions
shared/            vocabulary shared by server and web
web/src/           React app (pages, components, human-language copy in loanCopy.ts)
tests/             Vitest API/domain/concurrency tests
e2e/               Playwright two-person browser journeys
docs/DECISIONS.md  product and engineering decisions, rules and policies
```

The key ideas are below. More detail is in [docs/DECISIONS.md](docs/DECISIONS.md).

- **Rules live on the server and in the database.** Every action checks who you are and what state the loan is in. SQLite triggers back up the most important rules: two confirmed bookings can never overlap, only legal status changes are allowed, the people on a loan can't change, and evidence and history are append-only.
- **Conflicts are atomic.** Approvals and extension acceptances run in `BEGIN IMMEDIATE` transactions, which check and write as one step. A test races several separate OS processes against the same database file, and exactly one wins.
- **No double submissions.** Every write carries an `Idempotency-Key`, so a double-click or retry replays the first answer instead of acting twice. Buttons also lock while a write is in flight.
- **The server decides what you can do.** Each loan comes with its available actions and the reason any action is blocked ("Overlaps Priya's booking (Nov 7–10)"), so the UI never offers something the server will refuse.
- **Dates:** whole calendar days, inclusive, in the community time zone. See below.

### Date and time-zone policy

- Borrowing dates are calendar days (`YYYY-MM-DD`). A range is **inclusive**: Tue–Thu is 3 days, and the item is due by the end of Thursday.
- "Today" is the calendar day in `COMMUNITY_TIME_ZONE` (default `America/Toronto`), so everyone sees the same day regardless of their device's time zone.
- Ranges overlap when `a.start ≤ b.end && b.start ≤ a.end`, so the day an item comes back can't also be someone else's pickup day.
- A loan is **overdue** from the day after its due date (community time) until it's returned. It can always still be returned.
- Event timestamps are stored in UTC and shown in the community time zone.

## Seed data and photos

Running `npm run seed` gives you the same community every time, with dates relative to today. Demo item photos are openly licensed (CC0, public domain, CC BY, CC BY-SA). Credits are in [server/seed/photos/CREDITS.md](server/seed/photos/CREDITS.md) and in the app under *About & photo credits*.

## Not included (by design for V1)

Real accounts and passwords: identity is a demo person picker, though every action is still authorized on the server against that identity. Payments, deposits, insurance, ratings or reputation scores, geotracking, push notifications, native apps and group lending circles are all out of scope by design, as the vision specifies. Implementation results and known gaps are in [IMPLEMENTATION-RESULTS.md](IMPLEMENTATION-RESULTS.md).
