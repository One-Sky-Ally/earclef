'use client'

import { useState } from 'react'
import styles from './SuggestForm.module.css'

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'sent' }
  | { status: 'error' }

const WHY_MAX = 300

/**
 * Netlify Forms submission — POSTs urlencoded to the static detection stub
 * (public/__forms.html), which declares the "suggest-artist" form. Field
 * names must stay in sync with that file.
 */
export function SuggestForm() {
  const [state, setState] = useState<FormState>({ status: 'idle' })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const artist = data.get('artist')?.toString().trim()
    if (!artist) return

    setState({ status: 'submitting' })
    try {
      const body = new URLSearchParams({
        'form-name': 'suggest-artist',
        'bot-field': data.get('bot-field')?.toString() ?? '',
        artist,
        link: data.get('link')?.toString().trim() ?? '',
        why: data.get('why')?.toString().trim().slice(0, WHY_MAX) ?? '',
      })
      const res = await fetch('/__forms.html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      form.reset()
      setState({ status: 'sent' })
    } catch (error) {
      console.error('Suggestion submit failed:', error)
      setState({ status: 'error' })
    }
  }

  if (state.status === 'sent') {
    return (
      <p className={styles.sent}>
        Received — thank you. Every suggestion gets a real listen before an
        artist joins the roster.
      </p>
    )
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {/* Honeypot — humans never see it, bots fill it, Netlify drops those. */}
      <p className={styles.trap} aria-hidden="true">
        <label>
          Leave this empty: <input type="text" name="bot-field" tabIndex={-1} />
        </label>
      </p>

      <label className={styles.field}>
        <span className={styles.label}>Artist name</span>
        <input
          className={styles.input}
          type="text"
          name="artist"
          required
          maxLength={120}
          placeholder="Who should be here?"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>
          A link to their music <em>(optional)</em>
        </span>
        <input
          className={styles.input}
          type="url"
          name="link"
          maxLength={300}
          placeholder="https://…"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>
          Why them? <em>(optional)</em>
        </span>
        <textarea
          className={styles.textarea}
          name="why"
          rows={3}
          maxLength={WHY_MAX}
          placeholder="One or two sentences is plenty."
        />
      </label>

      {state.status === 'error' && (
        <p className={styles.error}>
          That didn&apos;t go through — please try again in a moment.
        </p>
      )}

      <button
        className={styles.submit}
        type="submit"
        disabled={state.status === 'submitting'}
      >
        {state.status === 'submitting' ? 'Sending…' : 'Suggest this artist'}
      </button>
    </form>
  )
}
