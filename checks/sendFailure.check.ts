// Checks for what a failed send tells the user.
//
// Until 2026-09-09 it told them nothing: the reason went to console.error and
// the message went back in the composer, which is indistinguishable from one
// they forgot to send. So they press Send again and hit the same wall.
import { describeSendFailure } from '../src/client/sendFailure.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const says = (e: unknown) => describeSendFailure(e)

console.log('== the ones that actually happen')
check('rate limiting says to wait',
  /wait|moment/i.test(says({ errcode: 'M_LIMIT_EXCEEDED' })))
check('too large names the file, not the server',
  /larger|size/i.test(says({ errcode: 'M_TOO_LARGE' })))
check('a 413 counts as too large even without an errcode',
  /larger/i.test(says({ httpStatus: 413 })))
check('forbidden says permission',
  /permission/i.test(says({ errcode: 'M_FORBIDDEN' })))
check('an unready encryptor says to reload, since that is the fix',
  /reload/i.test(says({ message: 'Cannot encrypt event in unconfigured room' })))
check('an unreachable server says the message was kept',
  /kept/i.test(says({})))

console.log('\n== nothing is silent')
for (const e of [null, undefined, {}, { errcode: 'M_UNKNOWN' }, { httpStatus: 500 }, new Error('boom'), 'a string']) {
  const out = says(e)
  check(`${JSON.stringify(e)?.slice(0, 22) ?? String(e)} produces a sentence`,
    typeof out === 'string' && out.trim().length > 15, { out })
}

console.log('\n== it never blames the user for a server fault')
check('an unknown errcode is quoted, not paraphrased into a guess',
  says({ errcode: 'M_WEIRD' }).includes('M_WEIRD'))
check('no raw error object leaks into the sentence',
  !/\[object Object\]|undefined/.test(says({ errcode: 'M_WEIRD' })))

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
