/**
 * Which upload a Discover card should play: official video first, then
 * audio, then a plain video; whole-record uploads never; non-official
 * uploads only from a trusted uploader (owner rulings, Oct 11 2026).
 *   node --test lib/play/officialVideo.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedUploader, isWholeRecordUpload, uploadKindOf } from './officialVideo.ts'
import { aliasKeysOf } from './titleVariants.ts'

test('official-video markers across languages rank first; audio markers second; the rest is a plain video', () => {
  assert.equal(uploadKindOf('Mipso - Hey, Coyote (Official Music Video)', 'Hey, Coyote', 'Mipso'), 'official-video')
  assert.equal(uploadKindOf('Rachid Taha - Ya Rayah (Clip Officiel)', 'Ya Rayah', 'Rachid Taha'), 'official-video')
  assert.equal(uploadKindOf('Diego El Cigala - Moreno Soy (Video Oficial)', 'Moreno Soy', 'Diego el Cigala'), 'official-video')
  assert.equal(uploadKindOf('Mansur Brown - Shiroi (Official Audio)', 'Shiroi', 'Mansur Brown'), 'audio')
  assert.equal(uploadKindOf('Mipso - "Edges Run" (Official Lyric Video)', 'Edges Run', 'Mipso'), 'audio')
  assert.equal(uploadKindOf('Tamikrest - Tisnant an Chatma', 'Tisnant an Chatma', 'Tamikrest'), 'video')
})

test('a Topic upload is audio whatever its title says', () => {
  assert.equal(uploadKindOf('Talk to God', 'Talk to God', 'Goat', 'Goat - Topic'), 'audio')
})

test("a song whose own title carries a marker word is read by its annotation only", () => {
  assert.equal(uploadKindOf('Band - Official Video', 'Official Video', 'Band'), 'video')
})

test('whole-record uploads are not a song', () => {
  assert.ok(isWholeRecordUpload('Hammock - Silencia (Full Album, Official Videos)', 'Silencia', 'Hammock'))
  assert.ok(isWholeRecordUpload('Goat - Live Ballroom Ritual [Full Album]', 'Live Ballroom Ritual', 'Goat'))
  assert.ok(isWholeRecordUpload('Amiina - Kurr [FullAlbum] 2007', 'Kurr', 'amiina'))
  assert.ok(!isWholeRecordUpload('Balmorhea - Candor (Official Video)', 'Candor', 'Balmorhea'))
})

test('trusted uploaders: the artist, their VEVO or official channel, their Topic channel, or a credited label', () => {
  const aliases = aliasKeysOf(['Mary Lattimore'])
  const labels = ['Ghostly International', 'Daptone Records', 'Hobbledehoy']
  assert.ok(isTrustedUploader('Mary Lattimore', aliases, labels))
  assert.ok(isTrustedUploader('MaryLattimoreVEVO', aliases, labels))
  assert.ok(isTrustedUploader('Mary Lattimore Official', aliases, labels))
  assert.ok(isTrustedUploader('Mary Lattimore - Topic', aliases, labels))
  assert.ok(isTrustedUploader('Ghostly International', aliases, labels))
  assert.ok(isTrustedUploader('DaptoneRecords', aliases, labels))
  assert.ok(isTrustedUploader('hobbledehoyrecords', aliases, labels))
  assert.ok(!isTrustedUploader('Norbert Tebarts', aliases, labels))
  assert.ok(!isTrustedUploader('Mary Lattimore Fan Archive', aliases, labels))
  assert.ok(!isTrustedUploader('', aliases, labels))
})

test('"And" and "&" name the same act: a Topic channel spelling the other one is still theirs (Nov 25, 2026)', () => {
  // YouTube's channel is "Mimi And Richard Farina - Topic"; MusicBrainz says "Mimi & Richard Fariña".
  const farinas = aliasKeysOf(['Richard & Mimi Fariña', 'Mimi & Richard Fariña'])
  assert.ok(isTrustedUploader('Mimi And Richard Farina - Topic', farinas, []))
  assert.ok(isTrustedUploader('Mimi and Richard Fariña', farinas, []))
  // …and the other way round.
  const simon = aliasKeysOf(['Simon and Garfunkel'])
  assert.ok(isTrustedUploader('Simon & Garfunkel - Topic', simon, []))
  assert.ok(isTrustedUploader('Simon + Garfunkel', simon, []))
  // Only a whole word between spaces is a connector, and the rest must still be equal.
  assert.ok(!isTrustedUploader('Mimi And Richard - Topic', farinas, []))
  assert.ok(!isTrustedUploader('Mimi And Richard Farina Tribute - Topic', farinas, []))
  assert.ok(!isTrustedUploader('Brand New - Topic', aliasKeysOf(['Br New']), []))
  assert.ok(!isTrustedUploader('Sandra - Topic', aliasKeysOf(['S & ra']), []))
})
