# Release readiness specification

## Scope

This release-readiness change hardens one core board behavior: a cross-column or cross-swimlane card drop must be atomic from the board user's point of view.

- Write the target frontmatter value before persisting manual card order.
- On a successful unsorted drop, persist the source and destination card orders after the frontmatter write succeeds.
- On a failed frontmatter write, restore the board from unchanged data and leave saved card orders unchanged.
- Keep the current behavior for sorted Bases views: moving between columns may still update the note, but manual card order is not saved.
- Make `npm test` work in Windows shells without relying on POSIX environment-variable assignment.

## Acceptance criteria

1. `npm test` runs on Windows and reports a passing suite.
2. A successful unsorted cross-column drop writes the note property and updates both affected manual card orders.
3. If that note-property write rejects, the board re-renders and does not write or mutate `cardOrders`.
4. The existing sorted-board and same-column drag rules remain unchanged.
5. `npm run format`, `npm run lint`, `npm test`, and `npm run build` pass.

## Non-goals

- No release, version bump, publication, or merge.
- No changes to existing dependency audit findings.
- No redesign of drag-and-drop, Bases integration, or persisted card-order schema.
- No automatic retry for a failed vault write; Obsidian remains the source of truth.

## Risks

- Deferring order persistence changes timing: a host metadata refresh can occur immediately after the write. The implementation must use the post-drop DOM order already produced by Sortable and persist it only after the write resolves.
- A failed write can briefly leave Sortable's DOM move visible. Re-rendering from unchanged Bases data is required to roll it back.
- Tests use Obsidian mocks; final acceptance still requires one manual Obsidian drag-and-drop check against a real vault.
