# /add-artist <name> — the fully-local roster pipeline

Add $ARGUMENTS to the Ear Clef roster. ALL research, verification, and AI
generation happens HERE in Claude Code (the owner's plan + this session's
browser) — the live site only ever serves the committed results. Nothing in
this pipeline may call the Anthropic API from the server, and nothing bills
the API wallet unless the claude CLI is unavailable AND you deliberately
fall back (FORCE_API=1).

Read EAR_CLEF_HANDOFF.md §7 first. Confirm the repo remote is
One-Sky-Ally/earclef before any push. One commit, one push at the end.

## 1. Verified research (agents + browser — same bar as the original roster)

Launch research agents (general-purpose, with web access) to gather, then
verify EVERYTHING yourself against live sources:

- MusicBrainz MBID: MB API search + disambiguation check (watch namesakes —
  the Burial/Queen problem). 1.1s pacing, UA
  "EarClefResearch/0.1 (fiohmemorial@gmail.com)".
- Official YouTube channel (UC…): feeds/videos.xml title check + handle
  canonical. NO "- Topic" channels, no fan channels; label/estate channels
  only when the artist has no own channel (say so in the content).
- 3–4 official video IDs: EACH verified via oEmbed author match.
- iTunes artistId: lookup API catalog match.
- 2–3 featured albums with MB release-group IDs (title + type + year).
- Streaming artist pages, browser-verified (JS shells defeat fetch): MB
  url-rels first; else find candidates on-platform (search agents / album
  click-through), then render each in the Browser pane and confirm the
  artist header/tab title + release list for collision-prone names. Store
  in listen.platforms. Never invent URLs; skip honestly when absent or
  when a page exists but is a name-collision shell.
- Past shows: setlist.fm pages individually fetched and matched
  (artist/date/venue). No invented dates; deceased artists keep memorial
  upcomingNotes.
- Merch: official store only, traced from the artist's own site; og:image
  or browser-extracted product image, verified 200 + image/*; https only;
  no fan/reseller shops; hide the section if nothing legit survives.
- Press: reputable outlets, every URL fetched live.

## 2. Write the content JSON

content/<slug>.json — exact schema of the existing 40 (copy a recent one as
the template). Tier "in-the-mix" unless told otherwise; tagline
"Hear here!"; honest empty sections; ogImage "/images/og-<slug>.jpg";
canonical https://earclef.netlify.app/<slug>. Story paragraphs: verified
facts only, no hedging.

## 3. Story cards — generated IN THIS SESSION (zero wallet)

Generate 2–4 cards for the artist yourself, in-session, applying the farm's
exact rules (read scripts/build-story-cards.mjs generatePrompt for the
authoritative wording): verifiable-facts-first (rule 0), atomic claims
tagged hard/soft + core, plural framing, no invented quotes, no hedging,
media only from the artist's verified video IDs or YouTube search URLs.
VERIFY every core claim against live sources yourself (Wikipedia +
structured sources for hard facts; 2+ reputable prose sources for soft
claims) — you have the browser and web search; use them. Drop shaky
incidental details instead of holding cards.

Write the results as data/story-cards-work/<slug>.json (same shape as the
existing work files: cards[] with id "<slug>-<hex-hash-of-hook>", slug,
artistName, type, hook, story, media, sources (the ones YOU opened),
status "published" only for verified cores, model: the session model,
at: ISO now). Then run:

    node scripts/build-story-cards.mjs --assemble

(Headless alternative for bulk runs: `node scripts/build-story-cards.mjs
--artists <slug>` uses the claude CLI on the owner's subscription when
logged in — `claude /login` once in a terminal; it falls back to the API
wallet ONLY if the CLI is unavailable, and logs which path it used.)

## 4. Validate + ship (one commit, one push)

    node scripts/validate-content.mjs            # structural
    node scripts/validate-content.mjs --remote   # ID verification
    npm run build                                # roster snapshot + SSG

Stop any dev server before `npm run build` (corrupts .next/dev otherwise).
Single conventional commit (no attribution footer), `git push origin main`,
poll the live URL, verify the page + /artists card + story cards API.

## 5. Post-deploy warm (blurbs — zero wallet)

The live blurbs route is serve-from-cache only. After the deploy lands and
the feed snapshot rebuilds (00:20 UTC nightly, or trigger
/.netlify/functions/feed-snapshot-background), warm the new artist's items:

    node scripts/warm-blurbs.mjs --slug <slug>   # claude CLI (subscription)

or, without CLI login, generate the missing blurbs in-session (the script's
--dry flag lists the misses; write blurbs per its embedded prompt rules)
and POST them to /api/studio/seed-blurbs with the OWNER_KEY.

## Report

Tell the owner: verified IDs (and how), sections filled vs hidden (and
why), story cards published/held, blurbs warmed, live URL — and confirm
the whole run made zero Anthropic API (wallet) calls.
