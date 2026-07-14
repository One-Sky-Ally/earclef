'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MemberRecord, UniversePost, UniversePostKind } from '@/lib/membership/types'
import { formatPostDate } from '@/components/universe/postMeta'
import styles from './UniversePanel.module.css'

interface UniversePanelProps {
  ownerKey: string
  slug: string
  artistName: string
}

interface PanelData {
  posts: UniversePost[]
  members: MemberRecord[]
}

const MEDIA_MAX_BYTES = 4 * 1024 * 1024

/** Reads a file as raw base64 (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** Audio duration in seconds via a throwaway element; null when unknown. */
function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    audio.src = url
  })
}

export function UniversePanel({ ownerKey, slug, artistName }: UniversePanelProps) {
  const [data, setData] = useState<PanelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<UniversePostKind>('text')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [alt, setAlt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [grantEmail, setGrantEmail] = useState('')

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-owner-key': ownerKey }),
    [ownerKey],
  )

  useEffect(() => {
    fetch(`/api/studio/universe?slug=${slug}`, { headers: { 'x-owner-key': ownerKey } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((panelData) => setData(panelData as PanelData))
      .catch(() => setError('The Universe panel could not load.'))
  }, [slug, ownerKey])

  async function act(payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/studio/universe', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ slug, ...payload }),
      })
      const result = (await res.json()) as Partial<PanelData> & { error?: string }
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`)
      setData((current) =>
        current
          ? {
              posts: result.posts ?? current.posts,
              members: result.members ?? current.members,
            }
          : current,
      )
      return true
    } catch (actionError) {
      setError((actionError as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    let media: { filename: string; contentType: string; dataBase64: string } | undefined
    let duration: number | undefined
    if (kind !== 'text') {
      if (!file) {
        setError(`${kind} posts need a file.`)
        return
      }
      if (file.size > MEDIA_MAX_BYTES) {
        setError('Files are capped at 4 MB here — larger masters go through the R2 flow.')
        return
      }
      media = {
        filename: file.name,
        contentType: file.type,
        dataBase64: await fileToBase64(file),
      }
      if (kind === 'audio') duration = (await probeDuration(file)) ?? undefined
    }
    const ok = await act({
      action: 'addPost',
      post: {
        kind,
        title: title.trim(),
        body: body.trim() || undefined,
        alt: alt.trim() || undefined,
        duration,
      },
      media,
    })
    if (ok) {
      setTitle('')
      setBody('')
      setAlt('')
      setFile(null)
    }
  }

  if (error && !data) return <p className={styles.error}>{error}</p>
  if (!data) return <p className={styles.quiet}>Opening the Universe panel…</p>

  return (
    <div className={styles.panel}>
      <h3 className={styles.subheading}>
        {artistName} — posts <span className={styles.count}>{data.posts.length}</span>
      </h3>
      {data.posts.length === 0 && (
        <p className={styles.quiet}>Nothing published yet.</p>
      )}
      <ul className={styles.list}>
        {data.posts.map((post) => (
          <li key={post.id} className={styles.row}>
            <span className={styles.rowKind}>{post.kind}</span>
            <span className={styles.rowTitle}>{post.title}</span>
            <span className={styles.rowMeta}>{formatPostDate(post.createdAt)}</span>
            <button
              type="button"
              className={styles.rowAction}
              disabled={busy}
              onClick={() => act({ action: 'removePost', id: post.id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form className={styles.form} onSubmit={publish}>
        <div className={styles.formRow}>
          <select
            className={styles.input}
            value={kind}
            onChange={(event) => setKind(event.target.value as UniversePostKind)}
            aria-label="Post kind"
          >
            <option value="text">Words</option>
            <option value="image">Image</option>
            <option value="audio">Sound</option>
          </select>
          <input
            className={styles.input}
            type="text"
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <textarea
          className={styles.textarea}
          placeholder={kind === 'text' ? 'The post itself' : 'Caption (optional)'}
          value={body}
          rows={3}
          onChange={(event) => setBody(event.target.value)}
        />
        {kind !== 'text' && (
          <div className={styles.formRow}>
            <input
              className={styles.input}
              type="file"
              accept={kind === 'audio' ? 'audio/mp4,audio/mpeg,.m4a,.mp3' : 'image/*'}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {kind === 'image' && (
              <input
                className={styles.input}
                type="text"
                placeholder="Alt text"
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
              />
            )}
          </div>
        )}
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? 'Working…' : 'Publish to members'}
        </button>
      </form>

      <h3 className={styles.subheading}>
        Members <span className={styles.count}>{data.members.length}</span>
      </h3>
      {data.members.length === 0 && (
        <p className={styles.quiet}>No members yet.</p>
      )}
      <ul className={styles.list}>
        {data.members.map((member) => (
          <li key={member.email} className={styles.row}>
            <span className={styles.rowTitle}>{member.email}</span>
            <span className={styles.rowMeta}>
              {member.source === 'comp' ? 'comped' : 'paid'} · through{' '}
              {formatPostDate(member.expiresAt)}
            </span>
            <button
              type="button"
              className={styles.rowAction}
              disabled={busy}
              onClick={() => act({ action: 'revoke', email: member.email })}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <form
        className={styles.formRow}
        onSubmit={async (event) => {
          event.preventDefault()
          if (!grantEmail.trim()) return
          const ok = await act({ action: 'grant', email: grantEmail.trim() })
          if (ok) setGrantEmail('')
        }}
      >
        <input
          className={styles.input}
          type="email"
          placeholder="friend@example.com"
          value={grantEmail}
          onChange={(event) => setGrantEmail(event.target.value)}
          aria-label="Email to gift a year"
        />
        <button className={styles.submit} type="submit" disabled={busy}>
          Gift a year
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
