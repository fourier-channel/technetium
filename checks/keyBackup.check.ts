// Checks for whether this account's conversations would survive losing the device.
//
// The failure guarded here is invisible until it is total: everything works
// perfectly right up until the device is gone, and then nothing does. So the
// property that matters is not "the label is right" but that only ONE state is
// allowed to tell the user their keys are safe.
//
// "A backup exists" is emphatically not that state. A backup this session is
// not connected to protects only what was already in it, and every key made
// since is going nowhere.
import {
  keyBackupState,
  keysAreProtected,
  keyBackupNeedsAttention,
  keyBackupCopy,
  type KeyBackupFacts,
  type KeyBackupState,
} from '../src/client/keyBackup.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ALL: KeyBackupFacts[] = []
for (const backupExists of [false, true])
  for (const backupTrusted of [false, true])
    for (const activeVersion of [null, '1', '7'])
      ALL.push({ backupExists, backupTrusted, activeVersion })

const show = (f: KeyBackupFacts) => JSON.stringify(f)

console.log(`\n-- only a live, trusted, connected backup means "safe", over all ${ALL.length} states --`)
{
  const protectedWithoutBackup = ALL.filter((f) => keysAreProtected(keyBackupState(f)) && !f.backupExists)
  check('never claims protection with no backup',
    protectedWithoutBackup.length === 0, protectedWithoutBackup.map(show))

  // The one people get wrong: a backup exists, so it must be fine. It is not.
  const protectedButDisconnected = ALL.filter(
    (f) => keysAreProtected(keyBackupState(f)) && !f.activeVersion)
  check('never claims protection while this session is not connected',
    protectedButDisconnected.length === 0, protectedButDisconnected.map(show))

  const protectedButUntrusted = ALL.filter(
    (f) => keysAreProtected(keyBackupState(f)) && !f.backupTrusted)
  check('never claims protection from an unverified backup',
    protectedButUntrusted.length === 0, protectedButUntrusted.map(show))

  const good = ALL.filter((f) => f.backupExists && f.backupTrusted && f.activeVersion)
  check('a genuinely working backup IS affirmed',
    good.every((f) => keysAreProtected(keyBackupState(f))), good.map(show))
  check('exactly one state means protected',
    (['active', 'present-disconnected', 'present-untrusted', 'absent'] as KeyBackupState[])
      .filter(keysAreProtected).length === 1)
}

console.log('\n-- trust is judged before connection --')
{
  // An untrusted backup described as "not connected yet" sounds like something
  // a button fixes. It is not: we cannot vouch that the user made it.
  const untrustedAndDisconnected: KeyBackupFacts = {
    backupExists: true, backupTrusted: false, activeVersion: null,
  }
  check('untrusted outranks disconnected',
    keyBackupState(untrustedAndDisconnected) === 'present-untrusted')
  const untrustedButActive: KeyBackupFacts = {
    backupExists: true, backupTrusted: false, activeVersion: '2',
  }
  check('an active session on an untrusted backup is still untrusted',
    keyBackupState(untrustedButActive) === 'present-untrusted')
}

console.log('\n-- attention is asked for exactly when something is wrong --')
{
  const needy = ALL.filter((f) => keyBackupNeedsAttention(keyBackupState(f)))
  check('every non-active state asks for attention',
    needy.every((f) => keyBackupState(f) !== 'active'))
  check('a working backup never nags',
    ALL.filter((f) => keyBackupState(f) === 'active').every((f) => !keyBackupNeedsAttention(keyBackupState(f))))
}

console.log('\n-- the copy names the consequence, not the mechanism --')
{
  const STATES: KeyBackupState[] = ['active', 'present-disconnected', 'present-untrusted', 'absent']
  const bad = STATES.filter((s) => {
    const c = keyBackupCopy(s)
    return !c.label || !c.detail || c.detail.length < 30
  })
  check('every state has real copy', bad.length === 0, bad)

  // The whole point of E8, said in words: what actually happens if you lose
  // the device. "Enable key backup" describes a setting; this describes a loss.
  check('the no-backup case says the conversations become unreadable',
    keyBackupCopy('absent').detail.includes('permanently unreadable'))
  check('the no-backup case names clearing the browser, which is what people do',
    keyBackupCopy('absent').detail.includes('clear this browser'))
  // A disconnected backup must not read as reassurance.
  check('the disconnected case says new messages are NOT being backed up',
    keyBackupCopy('present-disconnected').detail.includes('NOT being backed up'))
  check('only the active state promises restoration',
    STATES.filter((s) => keyBackupCopy(s).detail.includes('you can restore')).length === 1)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
