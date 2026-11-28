/**
 * A video that plays a remix, a live take or a demo is labelled so, in
 * the upload's own words (owner, Nov 26 2026: "when a video is a remix,
 * the label should say so"). Cases are the live Discover stock's.
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/play/versionNote.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labelledSongTitle, versionNote } from './versionNote.ts'
import { aliasKeysOf } from './titleVariants.ts'

const label = (song: string, upload: string, artist: string) =>
  labelledSongTitle(song, upload, artist, aliasKeysOf([artist]))

test('a remix plays under the remix name the video carries', () => {
  assert.equal(
    label('Hell Yeah (Pimp The System)', 'Hell Yeah (Pimp the System) (Remix)', 'dead prez'),
    'Hell Yeah (Pimp The System) (Remix)',
  )
  assert.equal(
    label('Is This The High Life?', 'Is This the High Life? [The Gentleman Callers of LA Remix]', 'The Puppini Sisters'),
    'Is This The High Life? (The Gentleman Callers of LA Remix)',
  )
  assert.equal(
    label('I Follow Rivers', 'Lykke Li - I Follow Rivers - Magician Remix [Music Video]', 'Lykke Li'),
    'I Follow Rivers (Magician Remix)',
  )
  assert.equal(
    label('National Crime Awareness Week', 'Sparks - National Crime Awareness Week (The Janet Leigh Mix) (Official Video)', 'Sparks'),
    'National Crime Awareness Week (The Janet Leigh Mix)',
  )
  assert.equal(label("Toca's Miracle", "Toca's Miracle (2000 Extended Mix)", 'Fragma'), "Toca's Miracle (2000 Extended Mix)")
})

test('live takes, demos and edits are labelled the same way, wherever the title puts the note', () => {
  assert.equal(label('Special', 'Mew - "Special" Live from Copenhagen', 'Mew'), 'Special (Live from Copenhagen)')
  assert.equal(
    label('Love And Memories', 'O.A.R. | Love and Memories | Live at Madison Square Garden [Official] Video', 'O.A.R.'),
    'Love And Memories (Live at Madison Square Garden)',
  )
  assert.equal(label('Plunger', 'Plunger (02/18/24 Jim Thorpe, PA) (Live)', 'Umphrey’s McGee'), 'Plunger (Live)')
  assert.equal(label('Turn It Up', 'Ugly Duckling "Turn it Up (Live)" Official Video', 'Ugly Duckling'), 'Turn It Up (Live)')
  assert.equal(label('Stuck', 'LEPROUS - Stuck - Radio Edit (OFFICIAL VIDEO)', 'Leprous'), 'Stuck (Radio Edit)')
  assert.equal(label("Don't Call Me Billy", "Don't Call Me Billy (Demo)", 'Elliott Smith'), "Don't Call Me Billy (Demo)")
  assert.equal(
    label('Latino Suite', 'The Montreux Years: McCoy Tyner – Latino Suite (Live at Montreux 1986)', 'McCoy Tyner'),
    'Latino Suite (Live at Montreux 1986)',
  )
  assert.equal(label('Tokyo', 'YUI - TOKYO-short ver.-', 'YUI'), 'Tokyo (short ver.)')
})

test('a band name or the song title carrying a version word is not a version', () => {
  assert.equal(
    label('World Of Inconvenience', 'Dub Trio - World Of Inconvenience (feat. King Buzzo) - Official Video', 'Dub Trio'),
    'World Of Inconvenience',
  )
  assert.equal(label('Buzzin’', "Asian Dub Foundation - Buzzin' (OFFICIAL MUSIC VIDEO)", 'Asian Dub Foundation'), 'Buzzin’')
  assert.equal(
    label('Live and Let Die', 'Paul McCartney & Wings - Live and Let Die (Official Video)', 'Paul McCartney & Wings'),
    'Live and Let Die',
  )
  assert.equal(label('Remix to Ignition', 'R. Kelly - Remix to Ignition (Official Video)', 'R. Kelly'), 'Remix to Ignition')
})

test('the plain record is not a version: album, single and original cuts, remasters, clean and explicit', () => {
  assert.equal(label('Song', 'Artist - Song (Album Version)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Original Mix)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Remastered 2011)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Clean Version) [Official Audio]', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Official Lyric Video)', 'Artist'), 'Song')
  assert.equal(label('Penny Lane', 'Penny Lane (Stereo Mix 2017)', 'The Beatles'), 'Penny Lane (Stereo Mix 2017)')
  assert.equal(label("Maradona (Kesä '86)", 'Teflon Brothers - Maradona (en español)', 'Teflon Brothers'), 'Maradona (en español)')
})

test('a note the title already carries is not repeated; one the video lacks still comes off', () => {
  assert.equal(
    label('Lost Where I Belong (Flying Lotus Remix)', 'Andreya Triana - Lost Where I Belong (Flying Lotus Remix)', 'Andreya Triana'),
    'Lost Where I Belong (Flying Lotus Remix)',
  )
  assert.equal(
    label('Lost Where I Belong (Flying Lotus Remix)', 'Andreya Triana - Lost Where I Belong (Official Video)', 'Andreya Triana'),
    'Lost Where I Belong',
  )
  assert.equal(label('Exodus / Revisited (Extended)', 'Exodus / Revisited (Edit)', 'UNKLE'), 'Exodus / Revisited (Edit)')
})

test('a note too long to show, or one that would still carry the title, falls back to the plain word', () => {
  assert.equal(
    versionNote('Song (Live at the Royal Albert Hall, London, England, 23 May 1971, second night)', 'Song', 'Artist'),
    'Live',
  )
  assert.equal(versionNote('Artist - Song', 'Song', 'Artist'), null)
  assert.equal(versionNote('', 'Song', 'Artist'), null)
})

test('code-review cases (Nov 26 2026): credits, nested brackets, inch marks, quality words, short titles', () => {
  assert.equal(label('Live Your Life (feat. Rihanna)', 'T.I. - Live Your Life ft. Rihanna', 'T.I.'), 'Live Your Life')
  assert.equal(label('Live and Let Die', 'Paul McCartney &amp; Wings - Live &amp; Let Die', 'Paul McCartney & Wings'), 'Live and Let Die')
  assert.equal(label('Song', 'Artist - Song (Live at Wembley (2005))', 'Artist'), 'Song (Live at Wembley)')
  assert.equal(label('Song', 'Artist - Song (Live at Wembley', 'Artist'), 'Song (Live at Wembley)')
  assert.equal(label('Blue Monday', 'New Order - Blue Monday (12" Version)', 'New Order'), 'Blue Monday (12" Version)')
  assert.equal(label('Comfortably Numb', 'Pink Floyd - Comfortably Numb (Live in 4K)', 'Pink Floyd'), 'Comfortably Numb (Live in 4K)')
  assert.equal(label('Demolition Man', 'Demolition Man (Demo)', 'The Police'), 'Demolition Man (Demo)')
  assert.equal(label('Live Forever', 'Oasis - Live Forever (Live)', 'Oasis'), 'Live Forever (Live)')
  assert.equal(label('i', 'Kendrick Lamar - i (Live on SNL)', 'Kendrick Lamar'), 'i (Live on SNL)')
  assert.equal(label('Song - Live', 'Artist - Song (Live from Wembley)', 'Artist'), 'Song - Live')
  assert.equal(label('Song', "Sinéad O'Connor & Asian Dub Foundation - Song", "Sinéad O'Connor"), 'Song')
  assert.equal(label('Song', 'Artist - Song (feat. Dub FX)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Dub Pistols - Song', 'The Dub Pistols'), 'Song')
  assert.equal(label('Doll Parts', 'Hole - Doll Parts (from the album "Live Through This")', 'Hole'), 'Doll Parts')
  assert.equal(label('Song', 'Artist - Song (Versión Original)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Remastered 2009 Version)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Music Video Version)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Cover Art)', 'Artist'), 'Song')
  assert.equal(label('Song', 'Artist - Song (Japanese Ver.)', 'Artist'), 'Song (Japanese Ver.)')
})

test('live takes are named in Spanish and Portuguese too (Proyecto Uno, Nov 28 2026)', () => {
  assert.equal(label('25 horas', 'PROYECTO UNO-25 HORAS (EN VIVO DESDE CASA LA MORADA)', 'Proyecto Uno'), '25 horas (EN VIVO DESDE CASA LA MORADA)')
  assert.equal(versionNote('Song (Ao Vivo)', 'Song', 'Artist'), 'Ao Vivo')
})
