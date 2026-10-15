/**
 * Where the owner's Discover sets take their taste from: the rows in the
 * owner's linked fan account (follows filed as Heavy rotation / In the
 * mix / On the radar). Until an account is linked — or if it holds
 * fewer than three Heavy rotation / In the mix artists — the owner's
 * original site-wide tiers stand in, so the owner's picks never fall
 * back to someone else's taste. Read by the stock endpoint, which hands
 * it to the /refresh-earclef session.
 */
import roster from './roster.json'
import { getOwnerAccount } from '../curation/ownerAccount'
import { getFan } from '../fans/store'
import { followTiers } from '../tiers'
import { rowsLibrary, type DiscoverLibrary } from './prompt'

const enoughRows = (library: DiscoverLibrary) =>
  library.kind === 'rows' && library.heavy.length + library.mix.length >= 3

export async function ownerLibrary(): Promise<{
  library: DiscoverLibrary
  source: 'account' | 'site-tiers'
}> {
  const email = await getOwnerAccount()
  const fan = email ? await getFan(email) : null
  if (fan) {
    const library = rowsLibrary(followTiers(fan.follows, fan.tiers), roster)
    if (enoughRows(library)) return { library, source: 'account' }
  }
  const siteTiers = Object.fromEntries(
    roster.flatMap((artist) => (artist.tier ? [[artist.slug, artist.tier]] : [])),
  )
  return { library: rowsLibrary(siteTiers, roster), source: 'site-tiers' }
}
