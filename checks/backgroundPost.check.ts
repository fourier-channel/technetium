// Checks for the post-then-reference background flow.
import { BACKGROUND_FLAG, isBackgroundPost } from '../src/client/backgroundPost.ts'
const { toItems } = await import('../src/client/useTimeline.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- isBackgroundPost --')
{
  check('flagged post recognised', isBackgroundPost({ msgtype: 'm.image', [BACKGROUND_FLAG]: { kind: 'domain' } } as any))
  check('chat kind recognised', isBackgroundPost({ msgtype: 'm.image', [BACKGROUND_FLAG]: { kind: 'chat' } } as any))
  check('an ordinary image is NOT one', !isBackgroundPost({ msgtype: 'm.image', body: 'cat.png' } as any))
  check('a text message is NOT one', !isBackgroundPost({ msgtype: 'm.text', body: 'hi' } as any))
  // A truthy non-object must not pass -- remote content is remote input.
  check('a string flag does not count', !isBackgroundPost({ [BACKGROUND_FLAG]: 'yes' } as any))
  check('empty content does not throw', !isBackgroundPost({} as any))
}

console.log('\n-- background posts stay out of the chat log --')
{
  const ev = (id: string, content: any): any => ({
    getId: () => id,
    getSender: () => '@a:x.net',
    getTs: () => 1,
    getType: () => 'm.room.message',
    isRedacted: () => false,
    // classify() asks these too; a double that omits them throws
    // rather than being classified, which is the harness noticing that the
    // real interface moved (E5).
    isDecryptionFailure: () => false,
    isBeingDecrypted: () => false,
    isEncrypted: () => false,
    getContent: () => content,
    getOriginalContent: () => content,
  })

  const items = toItems([
    ev('$1', { msgtype: 'm.text', body: 'hello' }),
    ev('$2', { msgtype: 'm.image', url: 'mxc://s/bg', [BACKGROUND_FLAG]: { kind: 'domain' } }),
    ev('$3', { msgtype: 'm.text', body: 'world' }),
  ])
  check('the background post is filtered out', items.length === 2, items.map((i) => i.id))
  check('real messages survive', items.map((i) => i.id).join(',') === '$1,$3')

  // An ordinary image must still render -- the filter keys on the flag only.
  const withImage = toItems([ev('$1', { msgtype: 'm.image', url: 'mxc://s/cat', body: 'cat.png' })])
  check('an ordinary image is untouched', withImage.length === 1)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
