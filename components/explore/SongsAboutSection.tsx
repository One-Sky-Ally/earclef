"use client";

import { useEffect, useState } from "react";
import { QueuePlayer } from "@/components/explore/QueuePlayer";
import { LikeButton } from "@/components/fans/LikeButton";
import { YouTubeEmbed } from "@/components/YouTubeEmbed";
import type { PlaceSong, PlaceSongs } from "@/lib/explore/songsAbout";
import styles from "./SongsAboutSection.module.css";

/**
 * "Songs about {Place}" (owner go, Oct 12 2026): songs written about
 * this country, state or nation, from Wikipedia's "Songs about" lists,
 * each with a video verified under the site's play bar. Every song
 * plays HERE: ▶ opens the song's own player in place, "Play all" runs
 * them as a queue. Nothing unplayable is ever listed (owner: "I don't
 * want to tease music people can't listen to"), so an empty answer
 * renders nothing at all. Songs about a city or a state inside the
 * country carry an "about {Place}" tag.
 */

interface SongsAboutSectionProps {
  placeCode: string;
  placeName: string;
}

type SectionState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; payload: PlaceSongs };

const TIER_BASE = 8;
const TIER_STEP = 20;
const VIDEO_ID = /^[\w-]{11}$/;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Render-time guard over the committed file: a song plays only with a well-formed id. */
function safeSongs(songs: PlaceSong[]): PlaceSong[] {
  return songs.filter((song) => VIDEO_ID.test(song.v) && song.t && song.a);
}

async function fetchSongs(
  place: string,
  signal: AbortSignal,
): Promise<PlaceSongs | null> {
  const res = await fetch(`/api/explore/songs-about/${place}`, { signal });
  if (!res.ok) return null;
  return res.json();
}

/** Keyed by place in the panel, so a new place starts from a fresh state. */
export function SongsAboutSection({
  placeCode,
  placeName,
}: SongsAboutSectionProps) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [visible, setVisible] = useState(TIER_BASE);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSongs(placeCode, controller.signal)
      .then((payload) =>
        setState(payload ? { status: "ready", payload } : { status: "none" }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "none" });
      });
    return () => controller.abort();
  }, [placeCode]);

  // Silent until ready: most places have no songs, and a shimmer that
  // usually vanishes into nothing reads as a glitch.
  if (state.status !== "ready") return null;
  const songs = safeSongs(state.payload.songs);
  if (songs.length === 0) return null;
  const shown = songs.slice(0, visible);
  const queue = songs.map((song) => ({
    videoId: song.v,
    title: song.t,
    artistName: song.ver ? `${song.a} (${song.ver})` : song.a,
    mbid: song.mbid,
  }));

  return (
    <section className={styles.section} aria-label={`Songs about ${placeName}`}>
      <h3 className={styles.heading}>Songs about {placeName}</h3>
      <p className={styles.note}>
        Songs written about this place, from Wikipedia&rsquo;s lists — only the
        ones we can play here.
      </p>

      {/* Touching the queue closes any open row player: one sound at a time. */}
      <div onClickCapture={() => setOpen(null)}>
        <QueuePlayer
          key={`songs-about:${placeCode}`}
          placeName={placeName}
          placeCode={placeCode}
          year={new Date().getFullYear()}
          pool={[]}
          roster={{}}
          preresolved={queue}
          buttonLabel={`▶ Play all — ${songs.length} song${songs.length === 1 ? "" : "s"} about ${placeName}`}
          endNote={`That's every song about ${placeName} we can play.`}
        />
      </div>

      <ol className={styles.list}>
        {shown.map((song) => {
          const isOpen = open === song.v;
          return (
            <li key={song.v} className={styles.row}>
              <div className={styles.line}>
                <button
                  type="button"
                  className={`${styles.play} ${isOpen ? styles.playOpen : ""}`}
                  onClick={() => setOpen(isOpen ? null : song.v)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Close" : "Play"} “${song.t}” by ${song.a}`}
                >
                  {isOpen ? "■" : "▶"}
                </button>
                <span className={styles.what}>
                  <span className={styles.title}>
                    “{song.t}”
                    {song.ver && <span className={styles.tag}>{song.ver}</span>}
                  </span>
                  <span className={styles.meta}>
                    {song.a}
                    {song.y ? ` · ${song.y}` : ""}
                    {song.about ? ` · about ${song.about}` : ""}
                  </span>
                </span>
                <LikeButton
                  variant="row"
                  track={{
                    videoId: song.v,
                    title: song.t,
                    artistName: song.a,
                    ...(MBID.test(song.mbid) ? { mbid: song.mbid } : {}),
                    placeCode,
                    placeName,
                    ...(song.y ? { year: song.y } : {}),
                  }}
                />
              </div>
              {isOpen && (
                <div className={styles.player}>
                  <YouTubeEmbed
                    video={{
                      youtubeId: song.v,
                      title: `${song.t} — ${song.a}`,
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {visible < songs.length && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setVisible((count) => count + TIER_STEP)}
        >
          Show {Math.min(TIER_STEP, songs.length - visible)} more ↓
        </button>
      )}
      {visible > TIER_BASE && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setVisible(TIER_BASE)}
        >
          Show fewer
        </button>
      )}
    </section>
  );
}
