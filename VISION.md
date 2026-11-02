# BorrowBox — Product Vision (Frozen v1)
BorrowBox is a warm, trustworthy personal lending library for friends and small communities, not an inventory administration system. A person lists an item with a beautiful image and clear borrowing rules; another explores the collection, requests dates, and coordinates handoff, use and return. Every screen should make the next action obvious.

## Experience principles
People before records. Trust without bureaucracy. Calm, human language. Great visual design: compelling items, thoughtful layout, polished mobile UI, accessible navigation, useful empty/loading/error states. Handle real life gracefully rather than exposing database statuses.

## Required V1 journeys
1. Owners list, edit, hide and explore items. Borrowers search/filter a visually rich catalog, inspect owner, lending rules, and availability.
2. Borrower requests date range with optional note; owner approves/declines; pending borrower cancels. A borrower cannot borrow their own item. Overlapping pending requests may exist; two overlapping requests must never both become approved, even under concurrent submissions.
3. Owner marks item ready, borrower confirms pickup, borrower initiates return with condition notes/photos, owner confirms return and adds separately attributed condition evidence. History records both viewpoints and disagreement, never silently overwrites evidence.
4. Borrower proposes a due-date extension, owner accepts or declines; extension approval must recheck scheduling conflicts. Late loans display overdue indicators but remain returnable.
5. Hide an item from new borrowing without cancelling existing reservations. Every user action is authorized on the server and survives refresh; prevent double-submission duplicates. Use explicit consistent date-range and time zone policy.

## Product and technical scope
Working responsive full-stack web app, server-side rules, persistent database, clean local startup, seeded demo identities (3+) and varied items (8+), automated tests and clear README. Choose stack and architecture independently. Paid third-party APIs not required. No payments, insurance, geotracking, native apps, external push, reputation scores or group lending circles. Never prebuild the surprise feature.

## Definition of done
A fresh evaluator can use two accounts to complete every real borrowing journey, handle a conflicting reservation and extension, and appreciate a coherent consumer product. Tests include authorization, state transitions and concurrency. The app genuinely starts locally; incomplete features and failures are clearly reported.

## Experimental boundary
Identical product vision for both arms. Do not inspect the other repo. Preserve this file unchanged; implementation decisions belong to the agent.
