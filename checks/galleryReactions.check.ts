// Reactions on a gallery (launch-polish L27).
//
// Operator, 2026-10-08: "emojis aren't attaching to the 'correct' post on a
// gallery, so they don't ever get shown." A gallery is one post on screen and
// several m.image events on the server. toItems built its row with no
// reactions at all, and the "+" sent to whichever image the row happened to
// be keyed by. Holds: the row shows every image's reactions as one set, a
// new reaction goes to the first image, and un-reacting takes back all of
// yours.
import { readFileSync } from 'node:fs'
import { mergeReactions, type ReactionTally } from '../src/client/relations.ts'
const { toItems } = await import('../src/client/useTimeline.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ME = '@me:x.net'
const A = '@a:x.net'
const B = '@b:x.net'

const base = (id: string, sender: string, ts: number, type: string, content: any): any => ({
  getId: () => id,
  getSender: () => sender,
  getTs: () => ts,
  getType: () => type,
  isRedacted: () => false,
  isDecryptionFailure: () => false,
  isBeingDecrypted: () => false,
  isEncrypted: () => false,
  getContent: () => content,
  getOriginalContent: () => content,
})
const image = (id: string, index: number, count: number, ts: number) =>
  base(id, A, ts, 'm.room.message', {
    msgtype: 'm.image',
    url: `mxc://x.net/${id.slice(1)}`,
    body: index === 0 ? 'the words' : `${id}.png`,
    ...(index === 0 ? { filename: `${id}.png` } : {}),
    'net.41chan.gallery': { id: 'batch1', index, count, layout: 'grid' },
  })
const react = (id: string, sender: string, ts: number, target: string, key: string) =>
  base(id, sender, ts, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: target, key } })

console.log('\n-- mergeReactions --')
{
  const t = (key: string, senders: string[], mine: string[] = []): ReactionTally => ({
    key, count: senders.length, mine: mine.length > 0, myEventId: mine[0] ?? null, myEventIds: mine, senders,
  })
  const m = mergeReactions([
    [t('+1', [A]), t('heart', [ME], ['$m1'])],
    undefined,
    [t('heart', [B, ME], ['$m2']), t('fire', [B])],
  ])
  check('keys in first-seen order across the images', m.map((x) => x.key).join(',') === '+1,heart,fire', m)
  const heart = m.find((x) => x.key === 'heart')!
  check('one person on two images counts once', heart.count === 2 && heart.senders.join(',') === `${ME},${B}`, heart)
  check('mine if mine anywhere', heart.mine === true)
  check('every one of my annotations is kept, so un-reacting can take all back',
    heart.myEventIds.join(',') === '$m1,$m2', heart.myEventIds)
  check('an image with no reactions is fine', mergeReactions([undefined, []]).length === 0)
}

console.log('\n-- a gallery row in toItems --')
{
  const items = toItems(
    [
      image('$i1', 0, 3, 100),
      image('$i2', 1, 3, 101),
      image('$i3', 2, 3, 102),
      // As this client used to send: to the row's own key, the first image.
      react('$r1', B, 110, '$i1', '+1'),
      // As another client sends: to the image that was clicked.
      react('$r2', A, 111, '$i3', '+1'),
      react('$r3', ME, 112, '$i2', 'heart'),
      react('$r4', ME, 113, '$i3', 'heart'),
    ],
    { myUserId: ME },
  )
  check('the three images are one row', items.length === 1 && items[0].kind === 'gallery', items.map((i) => i.kind))
  const g = items[0]
  const plus = g.reactions?.find((x) => x.key === '+1')
  check('the row HAS reactions (it had none before L27)', (g.reactions?.length ?? 0) === 2, g.reactions)
  check('a reaction on any image shows on the row', plus?.count === 2, plus)
  const heart = g.reactions?.find((x) => x.key === 'heart')
  check('mine on two images: counted once, both ids kept', heart?.count === 1 && heart.myEventIds.length === 2, heart)
  check('the row is keyed by the first image here, so it needs no separate target',
    g.id === '$i1' && g.reactTo === undefined, { id: g.id, reactTo: g.reactTo })

  // The window can meet a later image first -- out-of-order delivery, or the
  // first image arriving late. The row is keyed by what it met; a reaction
  // must still go to the FIRST image.
  const late = toItems([image('$j2', 1, 2, 201), image('$j1', 0, 2, 200)], { myUserId: ME })
  check('keyed by the image met first', late[0].id === '$j2', late[0].id)
  check('but reacts to the first image of the batch', late[0].reactTo === '$j1', late[0].reactTo)
}

console.log('\n-- the "+" and the pills use it --')
{
  const reactions = readFileSync('src/ui/Reactions.tsx', 'utf8')
  check('a new reaction is sent to reactTo when there is one',
    /const targetId = item\.reactTo \?\? item\.id/.test(reactions) && /event_id: targetId/.test(reactions))
  check('nothing still sends to item.id directly', !/event_id: item\.id/.test(reactions))
  check('un-reacting redacts every one of mine', /for \(const id of mine\) await client\.redactEvent/.test(reactions))
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
