# /refresh-earclef — the weekly zero-wallet content refresh

Run weekly or biweekly in Claude Code on the owner's plan. ALL model work
happens IN THIS SESSION (zero API wallet); the live site only ever serves
committed files and cached Blobs. Never create server-side scheduled AI
jobs. One commit/push at the end; update the handoff's refresh log line.

Read EAR_CLEF_HANDOFF.md §7 first. Check `git status` — coordinate with
any other session mid-work before committing.

## Phase A — feed blurb freshness (every missing blurb, every run)

EVERY item in the snapshot that lacks a blurb gets one this run, not
just the top of the feed. The default feed shows the newest 50, but the
tier and "following" filters reach the whole 600-item snapshot, and
misses left for "next runs" pile up: Jul 30 filled 120 of 397 and Aug 6
the newest 60 of 318, and after five skipped weeks Sep 16 found 399.
Only this phase ever writes blurbs, so whatever it leaves stays missing.

1. `node scripts/list-blurb-misses.mjs` → JSON list of EVERY snapshot
   item whose blurb cache entry is missing (probes the whole prod
   snapshot against the cache; roster growth and new uploads are the
   usual sources). Note the count for the log.
2. Write ALL the missing blurbs IN-SESSION. Rules (same as the farm):
   metadata + general knowledge ONLY, never scraped text; name
   collaborators only when certain; 1–2 sentences; specific when you
   know the release, honest metadata-derived when you don't. A few
   hundred is normal after a gap or a roster expansion; finish them
   before Phase B.
3. Seed via `POST https://earclef.com/api/studio/seed-blurbs` with
   `x-owner-key` (OWNER_KEY in .env.local), body
   `{"blurbs": {"v2/<slug>/<type>/<normalizedTitle>": "text", ...}}`,
   ≤60 keys per batch. Verify: re-run the miss lister → it must print
   an EMPTY list. Anything left: write and seed it, then re-run again.
4. The feed snapshot itself self-rebuilds every night server-side (no
   AI): `feed-snapshot-schedule` ticks every hour at :20 UTC, the 00:20
   tick starts the rebuild (~20 min across chained batches), and later
   ticks exit "fresh" — or re-trigger a stale snapshot / resume a parked
   chain. Check it with
   `curl -H "x-owner-key: $OWNER_KEY" https://earclef.com/api/studio/feed-status`
   (builtAt, isFresh, progress, lock; the public /api/feed/snapshot is
   CDN-cached up to 3h and can show an older builtAt than the store).
   `isFresh: false` with no progress after ~01:00 UTC means the ticks are
   not reaching the site: read the Netlify function log for
   `feed-snapshot-schedule` (Netlify → the site → Logs → Functions);
   every tick logs one line saying fresh/stale and whether the trigger
   was accepted. Rebuild by hand only after that:
   `curl -X POST https://earclef.com/.netlify/functions/feed-snapshot-background`
   (202 = accepted; watch feed-status until progress clears). After ANY
   rebuild, re-run the miss lister — a rebuild rotates new items in — and
   cover those too, back to an empty list.

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

## Phase D — self-filed artists (~5 min, only when the inbox has any)

Artists who followed /get-on-the-map email oneskyally@gmail.com with
their MusicBrainz link (and, for the cap bypass, a page they control).

1. For every country named in the inbox:
   `node scripts/build-country-data.mjs --only XX --refresh` (merge is
   monotonic; a re-sweep only ever adds rows). A US-state / UK-nation
   artist also needs the region pass: `node scripts/build-state-data.mjs
   --region US-XX`.
2. Cap bypass (only when the country file says `truncated: true`, or
   the artist asks): `node scripts/self-filed.mjs mint <mbid> --url
   <page>` → reply with the printed token; once they say it is posted,
   `node scripts/self-filed.mjs verify <mbid>`. Entries are served ONLY
   with url + token + verifiedAt all present — never hand-edit
   verifiedAt. Refused hosts (musicbrainz, discogs, wikidata,
   wikipedia, earclef) are refused on purpose: proof of control, not
   proof of an account.
3. `node scripts/self-filed.mjs refresh` re-reads MusicBrainz fields
   (career years, tags) for verified rows.
4. Reply to each artist with what actually happened: listed, pinned, or
   why not (usually: no Area or no begin date on their record).

## Phase E — Discover picks (~10 min of attention; checks run in the background)

Discover is stocked here and ONLY here — no model call anywhere on the
site, no nightly job (owner ruling, Oct 15 2026). Two lists: SHARED,
one set of 12 a day for everyone (when it runs out, earlier sets come
back "from the archive" — never empty, never a paid fallback); OWNER,
the owner's own sets of 8, one per day they visit, from the rows in
their linked account (when it runs out they see the shared picks).
Each refresh adds up to two weeks of sets per list, growing toward 60
shared days / 30 owner sets. Start the checks EARLY — right after
Phase A's miss list — so they run while you write blurbs.

1. `npm run discover-stock -- recheck` — drops stocked songs whose
   YouTube video died (the pick stays, with its link).
2. `npm run discover-stock -- plan` — reads what is ready on the site
   and writes `data/discover-stock/brief-shared.txt` and
   `brief-owner.txt` (counts include a margin for failures). Nothing to
   add → skip to the log line.
3. Write the candidates IN-SESSION, following each brief exactly, into
   `data/discover-stock/candidates.json` as
   `{"shared": [...], "owner": [...]}`, each entry
   `{"name", "why", "knownFor", "connectsTo": ["<roster id>", …]}`.
   Real artists you are confident exist, names exactly as credited,
   genuinely lesser-known, never on the roster or in the brief's
   already-stocked list; "why" names the roster artist it connects to;
   the shared list spreads across the WHOLE roster; the owner list
   follows their rows. Write them in batches if it is long.
4. `npm run discover-stock -- verify` in the BACKGROUND (default 90-min
   budget; `--minutes N` to change). Each candidate is checked like
   every Discover pick: MusicBrainz by exact name, the knownFor title in
   their catalogue, a verified playable song (Discogs record videos
   with DISCOGS_TOKEN — albums first, up to 25 records, stopping once 8
   songs verify — then their own channel). ~15–30 s a pick. ONLY picks
   with a verified playable song are stocked (owner ruling, Oct 15
   2026: same rule as Songs about this place); the rest are skipped and
   logged with the reason ("no playable song", "not on MusicBrainz",
   "no catalogue", "on the roster"). "musicbrainz unavailable" and "song
   lookup unavailable" are not verdicts: MusicBrainz, Discogs or YouTube
   did not answer, and the next `verify` run tries that candidate again.
   A burst of quick "no playable song" skips for artists with obvious
   videos means an upstream call is failing — trace one with `why`. Progress is saved after every
   pick — out of time or interrupted, run it again and it continues.
   Candidates ran out short of the target → write a few more and verify
   again, or upload what is done.
5. A skip that looks wrong (the artist plainly has official videos) →
   `npm run discover-stock -- why "<artist>" "<knownFor>"` prints every
   step: the Discogs records read, each video and whether its title
   passed, the channel path, each candidate's playability and trust,
   and the verdict. Fix the cause in the matcher if it is a matching
   gap; never hand-add a song.
6. `npm run discover-stock -- upload` — sends FULL sets only; leftovers
   wait in `verified.json` for the next refresh. The upload refuses any
   pick without a song, and the site never shows one.
7. `npm run discover-stock -- status` → note "shared N days ahead,
   owner N sets" for the log line.

## Close out

- `node scripts/validate-content.mjs` + `npm run build` must pass.
- One commit/push (playing.json, any content, this doc if amended).
- Update the handoff refresh-log line: date, blurb misses found →
  seeded → remaining (remaining must be 0), combos added, year-roll
  result, story-card coverage status, Discover stock (shared days
  ahead, owner sets ready, verified/checked, songs dropped).
- Post-deploy: probe one new combo on earclef.com and one seeded blurb,
  and check the Discover row on /artists says "Today's picks for
  everyone" (not "From the archive").
