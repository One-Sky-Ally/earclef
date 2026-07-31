# /refresh-earclef — the weekly zero-wallet content refresh

Run weekly or biweekly in Claude Code on the owner's plan. ALL model work
happens IN THIS SESSION (zero API wallet); the live site only ever serves
committed files and cached Blobs. Never create server-side scheduled AI
jobs. One commit/push at the end; update the handoff's refresh log line.

Read EAR_CLEF_HANDOFF.md §7 first. Check `git status` — coordinate with
any other session mid-work before committing.

## Phase A — feed blurb freshness (~5 min)

1. `node scripts/list-blurb-misses.mjs` → JSON list of feed items whose
   blurb cache entry is missing (probes the prod snapshot against the
   cache; roster growth is the usual source).
2. Write the missing blurbs IN-SESSION. Rules (same as the farm):
   metadata + general knowledge ONLY, never scraped text; name
   collaborators only when certain; 1–2 sentences; specific when you
   know the release, honest metadata-derived when you don't.
3. Seed via `POST https://earclef.com/api/studio/seed-blurbs` with
   `x-owner-key` (OWNER_KEY in .env.local), body
   `{"blurbs": {"v2/<slug>/<type>/<normalizedTitle>": "text", ...}}`,
   ≤60 keys per batch. Verify: re-run the miss lister → near-empty.
4. The feed snapshot itself self-rebuilds daily server-side (no AI) —
   nothing to do unless /api/feed/snapshot reports stale.

## Phase B — "What was playing" combos (~15 min)

1. Pick 1–3 combos from the researched queue in the handoff (next up:
   Cuba 1950s, Japan/Oricon 1968+, Australia, Sweden, Italy; then
   whatever new research surfaces). One combo done well beats three
   done thin.
2. THE GATE (unchanged): kind "charted" only where a real chart archive
   backs every item note; otherwise "documented" touchstones with an
   honest basis line, NO rankings. Verify every source URL live
   (curl 200 with browser UA); grep item-level facts on the cited pages
   (chart positions, years, performers) — never from memory. Spawn a
   research agent for anything not already researched in the handoff.
3. Append entries to lib/explore/playing.json (schema in playing.ts).
   Sanity-check era matching with the node snippet pattern from the
   handoff (overlap boundaries, full-range sweeps). No code changes
   needed — the route serves the committed file.
4. YEAR-ROLL PASS: the four 2020–2026 "through the present" combos
   (US, GB, DE, ES) — check the Wikipedia number-one list tables for
   new #1 records/milestones since the last refresh; extend `to:` at
   year boundaries. Table-greps only, no invention. Most weeks: no-op.

## Phase C — story cards for new artists (optional, own session if big)

Check coverage: roster slugs in content/ vs slugs in
lib/stories/cards.json. A handful of gaps → generate in-session under
the farm's gate rules (tiered authority, trim-don't-reject, no drafts).
A large gap (10+ artists) → note it and run a dedicated session or the
farm in CLI mode (requires the one-time `claude /login` in a plain
terminal; see handoff).

## Close out

- `node scripts/validate-content.mjs` + `npm run build` must pass.
- One commit/push (playing.json, any content, this doc if amended).
- Update the handoff refresh-log line: date, blurbs seeded, combos
  added, year-roll result, story-card coverage status.
- Post-deploy: probe one new combo on earclef.com and one seeded blurb.
