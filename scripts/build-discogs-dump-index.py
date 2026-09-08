#!/usr/bin/env python3
"""
DISCOGS MONTHLY DUMP → LOCAL COUNTRY INDEX (owner go, Sep 6, 2026).

WHY. The gap-fill sweep paid two API calls per release (a search page
row + /releases/{id}) at Discogs's 60/min ceiling, and the search layer
LIED twice over: its default sort is unstable across pages (Ethiopia's
1,351 items paged to 992–1,102 unique — every unsorted sweep silently
lost ~20–25% of its releases) and it has a hard 10,000-item wall.
Discogs publishes the whole catalog monthly under CC0 at
https://data.discogs.com — the same per-release record the API serves,
country string and structured artist credits included. One streaming
pass here replaces every Discogs call the sweep ever made, for every
country at once, with no pagination to lie.

Rule on the record (standing lesson 4): the release's own <country>
element is the shard key, exactly as the record-level guard compared
the detail record's country field. Nothing is inferred from a query.

No third-party dependency: Python's stdlib iterparse is the standard
tool for this dump (discogs-xml2db lineage), and the repo's Node code
consumes the JSON this writes (scripts/lib/discogsDump.mjs).

Modes:
  releases  → index/releases-by-country/<slug>.jsonl.gz, one compact
              row per release; index/countries.json (string → slug,
              totals, dated/undated, per-year counts)
  artists   → index/artists/<xx>.jsonl.gz sharded by id % 256:
              name, realname, PROFILE TEXT (the nationality signal —
              "Italian-born Uruguayan bandoneonist…"), name variations,
              aliases, groups/members, urls

Usage:
  gzip -dc data/discogs-dump/discogs_20260901_releases.xml.gz \
    | python3 scripts/build-discogs-dump-index.py releases --stdin \
        --source discogs_20260901_releases.xml.gz
  python3 scripts/build-discogs-dump-index.py artists \
        --dump data/discogs-dump/discogs_20260901_artists.xml.gz

  --limit N          stop after N records (testing)
  --allow-truncated  tolerate a truncated stream (testing on a partial
                     download ONLY — meta.complete is then false and the
                     index must never be trusted for a sweep)

A run that does not reach the closing tag writes meta.complete=false;
the Node reader refuses to serve an incomplete index.
"""
import argparse
import gzip
import json
import os
import re
import resource
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

INDEX_DIR_DEFAULT = 'data/discogs-dump/index'
PROGRESS_EVERY = 250_000
YEAR_RE = re.compile(r'^(\d{4})')
# Discogs's placeholder credits (Various / Unknown Artist / No Artist).
GENERIC_CREDIT_IDS = {194, 118760, 355}
# videos-by-artist bounds (see the writer): rows per release, tracks and
# extra credits per row. A gap-fill artist's own records are small; the
# giant compilations these caps touch anchor nothing for anyone.
MAX_CREDITED_ROWS = 40
MAX_TRACKLIST_PER_ROW = 80
MAX_EXTRA_PER_ROW = 60


def slugify(country: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', country.lower()).strip('-')
    return slug or 'unknown'


def raise_file_limit() -> None:
    # One gzip writer per Discogs country string (~260) — above macOS's
    # default 256 soft limit.
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    wanted = 4096 if hard == resource.RLIM_INFINITY else min(4096, hard)
    if soft < wanted:
        resource.setrlimit(resource.RLIMIT_NOFILE, (wanted, hard))


def open_source(args):
    if args.stdin:
        return sys.stdin.buffer
    if args.dump.endswith('.gz'):
        # gzip -dc in its own process: decompression runs on a second
        # core instead of inside the parser loop.
        proc = subprocess.Popen(['gzip', '-dc', args.dump], stdout=subprocess.PIPE)
        return proc.stdout
    return open(args.dump, 'rb')


def text(elem, tag):
    child = elem.find(tag)
    return child.text if child is not None and child.text else None


def year_of(released):
    if not released:
        return None
    match = YEAR_RE.match(released)
    if not match:
        return None
    year = int(match.group(1))
    return year if year > 0 else None


class ShardWriters:
    """gzip JSONL writers keyed by shard name, opened lazily."""

    def __init__(self, directory):
        self.directory = directory
        self.files = {}
        os.makedirs(directory, exist_ok=True)

    def write(self, shard, row):
        handle = self.files.get(shard)
        if handle is None:
            handle = gzip.open(os.path.join(self.directory, f'{shard}.jsonl.gz'), 'wt',
                               encoding='utf-8', compresslevel=5)
            self.files[shard] = handle
        handle.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')))
        handle.write('\n')

    def close(self):
        for handle in self.files.values():
            handle.close()


def release_row(elem):
    """Compact on-disk row (expanded to readable keys by the Node reader)."""
    released = text(elem, 'released')
    artists = []
    credits = elem.find('artists')
    if credits is not None:
        for credit in credits.findall('artist'):
            try:
                credit_id = int(text(credit, 'id') or 0)
            except ValueError:
                credit_id = 0
            if credit_id <= 0:
                continue
            row = {'i': credit_id, 'n': text(credit, 'name') or ''}
            anv = text(credit, 'anv')
            if anv:
                row['v'] = anv
            artists.append(row)
    labels = []
    label_list = elem.find('labels')
    if label_list is not None:
        for label in label_list.findall('label'):
            labels.append([label.get('name') or '', label.get('catno') or ''])
    formats = []
    descriptions = []
    format_list = elem.find('formats')
    if format_list is not None:
        for fmt in format_list.findall('format'):
            name = fmt.get('name')
            if name and name not in formats:
                formats.append(name)
            desc_list = fmt.find('descriptions')
            if desc_list is not None:
                for desc in desc_list.findall('description'):
                    if desc.text and desc.text not in descriptions:
                        descriptions.append(desc.text)
    # Companies with their role ("Pressed By", "Recorded At", "Published
    # By"…): the pressing plant is the record-level fact that localises
    # a "USSR"/"Yugoslavia" release to a city (owner go, Sep 7, 2026).
    companies = []
    company_list = elem.find('companies')
    if company_list is not None:
        for company in company_list.findall('company'):
            name = text(company, 'name')
            if name:
                companies.append([name, text(company, 'entity_type_name') or ''])
    # Community videos attached to the release (owner go, Sep 7, 2026):
    # the verified-play sweep's candidate source, previously fetched at
    # 55/min with a four-release cap per artist. Kept OFF the country
    # rows (size) and written to videos-by-artist shards instead.
    videos = []
    for video in elem.findall('videos/video'):
        src = video.get('src')
        if not src:
            continue
        duration = video.get('duration')
        try:
            duration = int(duration) if duration else None
        except ValueError:
            duration = None
        videos.append([src, text(video, 'title') or '', duration])
    genres = [g.text for g in elem.findall('genres/genre') if g.text]
    styles = [s.text for s in elem.findall('styles/style') if s.text]
    tracks = [t.text for t in elem.findall('tracklist/track/title') if t.text]
    # Full tracklist for the identity bar (per-track credits anchor a
    # video to THIS artist's track; durations corroborate within ±3 s).
    # Only carried on videos-by-artist rows, never on country rows.
    tracklist = []
    for track in elem.findall('tracklist/track'):
        track_credits = []
        for credit in track.findall('artists/artist'):
            try:
                cid = int(text(credit, 'id') or 0)
            except ValueError:
                cid = 0
            if cid > 0:
                track_credits.append(cid)
        tracklist.append([text(track, 'position') or '', text(track, 'title') or '',
                          text(track, 'duration') or '', track_credits])
    # Release-level extra credits with roles (featured / performer
    # anchors are weaker than the main credit; the arbitrator ranks them).
    extra_credits = []
    for credit in elem.findall('extraartists/artist'):
        try:
            cid = int(text(credit, 'id') or 0)
        except ValueError:
            cid = 0
        if cid > 0:
            extra_credits.append([cid, text(credit, 'name') or '', text(credit, 'role') or ''])
    master = text(elem, 'master_id')
    row = {
        'i': int(elem.get('id')),
        't': text(elem, 'title') or '',
        'c': text(elem, 'country'),
        'y': year_of(released),
        'r': released,
        'a': artists,
        'l': labels,
        'f': formats,
        'fd': descriptions,
        'g': genres,
        's': styles,
        'k': tracks,
        'co': companies,
    }
    if master:
        row['m'] = int(master)
    return row, videos, tracklist, extra_credits


def artist_row(elem):
    def named(path):
        out = []
        for node in elem.findall(path):
            if node.text:
                entry = {'n': node.text}
                if node.get('id'):
                    entry['i'] = int(node.get('id'))
                out.append(entry)
        return out
    row = {'i': int(text(elem, 'id') or 0), 'n': text(elem, 'name') or ''}
    realname = text(elem, 'realname')
    profile = text(elem, 'profile')
    if realname:
        row['rn'] = realname
    if profile:
        row['p'] = profile
    variations = [n.text for n in elem.findall('namevariations/name') if n.text]
    if variations:
        row['nv'] = variations
    for key, path in (('al', 'aliases/name'), ('gr', 'groups/name'), ('me', 'members/name')):
        values = named(path)
        if values:
            row[key] = values
    urls = [u.text for u in elem.findall('urls/url') if u.text]
    if urls:
        row['u'] = urls
    return row


def run(args):
    raise_file_limit()
    index_dir = args.out
    os.makedirs(index_dir, exist_ok=True)
    mode = args.mode
    record_tag = 'release' if mode == 'releases' else 'artist'
    writers = ShardWriters(os.path.join(index_dir, 'releases-by-country' if mode == 'releases' else 'artists'))
    # Two stores: a tiny artist → release-id map, and each video-bearing
    # release stored ONCE by release id (a per-artist copy of every
    # tracklist made the first attempt several GB).
    video_writers = ShardWriters(os.path.join(index_dir, 'videos-by-artist')) if mode == 'releases' else None
    video_release_writers = ShardWriters(os.path.join(index_dir, 'video-releases')) if mode == 'releases' else None
    counts = {}
    started = time.time()
    records = 0
    video_releases = 0
    video_rows = 0
    complete = False
    truncated_error = None
    source = open_source(args)
    root = None
    try:
        for event, elem in ET.iterparse(source, events=('start', 'end')):
            if event == 'start':
                if root is None:
                    root = elem
                continue
            if elem.tag != record_tag:
                continue
            records += 1
            if mode == 'releases':
                row, videos, tracklist, extra_credits = release_row(elem)
                country = row['c']
                shard = slugify(country) if country else '_no-country'
                writers.write(shard, row)
                if videos:
                    video_releases += 1
                    # One row per artist credited on the release OR on a
                    # track OR as an extra credit: the identity bar asks
                    # "which videos sit on records this artist is on".
                    # BOUNDED: a 100-track various-artists compilation
                    # with per-track credits would otherwise write 100
                    # rows of 100 tracks each (quadratic; the first
                    # attempt stalled). Placeholder credits never get a
                    # row; past MAX_CREDITED_ROWS artists only the main
                    # credits do; a row's tracklist is capped and flagged.
                    main_ids = [c['i'] for c in row['a'] if c['i'] not in GENERIC_CREDIT_IDS]
                    credited = set(main_ids)
                    for track in tracklist:
                        credited.update(track[3])
                    credited.update(extra[0] for extra in extra_credits)
                    credited.difference_update(GENERIC_CREDIT_IDS)
                    if len(credited) > MAX_CREDITED_ROWS:
                        credited = set(main_ids)
                    track_ids = set()
                    for track in tracklist:
                        track_ids.update(track[3])
                    extra_ids = {extra[0] for extra in extra_credits}
                    for artist_id in credited:
                        video_rows += 1
                        kind = 'm' if artist_id in main_ids else 't' if artist_id in track_ids else 'x'
                        video_writers.write(f'{artist_id % 256:02x}', {'a': artist_id, 'r': row['i'], 'k': kind})
                    if credited:
                        video_release_writers.write(f'{row["i"] % 256:02x}', {
                            'i': row['i'], 't': row['t'], 'y': row['y'], 'c': country,
                            'cs': row['a'], 'x': extra_credits[:MAX_EXTRA_PER_ROW],
                            'tl': tracklist[:MAX_TRACKLIST_PER_ROW],
                            **({'tt': True} if len(tracklist) > MAX_TRACKLIST_PER_ROW else {}),
                            'vs': videos,
                        })
                bucket = counts.setdefault(country or '', {'slug': shard, 'total': 0, 'dated': 0, 'undated': 0, 'byYear': {}})
                bucket['total'] += 1
                if row['y'] is None:
                    bucket['undated'] += 1
                else:
                    bucket['dated'] += 1
                    year_key = str(row['y'])
                    bucket['byYear'][year_key] = bucket['byYear'].get(year_key, 0) + 1
            else:
                row = artist_row(elem)
                if row['i'] <= 0:
                    continue
                writers.write(f'{row["i"] % 256:02x}', row)
            root.clear()
            if records % PROGRESS_EVERY == 0:
                elapsed = time.time() - started
                print(f'  {records:,} {mode} · {elapsed / 60:.1f} min', flush=True)
            if args.limit and records >= args.limit:
                break
        else:
            complete = True
    except ET.ParseError as error:
        truncated_error = str(error)
        if not args.allow_truncated:
            writers.close()
            raise
    writers.close()
    if video_writers:
        video_writers.close()
        video_release_writers.close()
    if args.limit and records >= args.limit:
        complete = False
    meta_path = os.path.join(index_dir, f'{mode}-meta.json')
    meta = {
        'source': args.source or args.dump,
        'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'records': records,
        'elapsedMinutes': round((time.time() - started) / 60, 1),
        'complete': complete and not args.limit,
        'limit': args.limit or None,
        'truncatedError': truncated_error,
    }
    if mode == 'releases':
        meta['videosByArtist'] = {'releasesWithVideos': video_releases, 'rows': video_rows}
    with open(meta_path, 'w', encoding='utf-8') as handle:
        json.dump(meta, handle, indent=2, ensure_ascii=False)
    if mode == 'releases':
        ordered = dict(sorted(counts.items(), key=lambda item: -item[1]['total']))
        with open(os.path.join(index_dir, 'countries.json'), 'w', encoding='utf-8') as handle:
            json.dump({'source': meta['source'], 'complete': meta['complete'], 'countries': ordered},
                      handle, indent=1, ensure_ascii=False)
    print(f'DONE — {records:,} {mode} in {meta["elapsedMinutes"]} min · complete={meta["complete"]}'
          + (f' · TRUNCATED: {truncated_error}' if truncated_error else ''), flush=True)
    return 0 if meta['complete'] or args.limit or args.allow_truncated else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=['releases', 'artists'])
    parser.add_argument('--dump', help='path to discogs_YYYYMMDD_<mode>.xml(.gz)')
    parser.add_argument('--stdin', action='store_true', help='read decompressed XML from stdin')
    parser.add_argument('--source', help='label for meta when reading stdin')
    parser.add_argument('--out', default=INDEX_DIR_DEFAULT)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--allow-truncated', action='store_true')
    args = parser.parse_args()
    if not args.stdin and not args.dump:
        parser.error('--dump or --stdin required')
    sys.exit(run(args))


if __name__ == '__main__':
    main()
