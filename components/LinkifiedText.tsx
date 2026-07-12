import { Fragment } from 'react'

// Bare domains (optionally with a path) inside prose, e.g.
// "new dates are announced via florenceandthemachine.net".
const URL_SPLIT =
  /\b((?:[a-z0-9-]+\.)+(?:com|net|org|fm|io|co|us|app|es|uk|de)(?:\/[^\s,)]*)?)/gi
const URL_TEST =
  /^(?:[a-z0-9-]+\.)+(?:com|net|org|fm|io|co|us|app|es|uk|de)(?:\/[^\s,)]*)?$/i

/** Render plain text with bare domains turned into outbound links. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT).map((part, index) => {
        if (!URL_TEST.test(part)) {
          return <Fragment key={index}>{part}</Fragment>
        }
        const clean = part.replace(/[.,;:]+$/, '')
        const trailing = part.slice(clean.length)
        return (
          <Fragment key={index}>
            <a href={`https://${clean}`} target="_blank" rel="noreferrer">
              {clean}
            </a>
            {trailing}
          </Fragment>
        )
      })}
    </>
  )
}
