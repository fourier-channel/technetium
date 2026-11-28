// Checks for boo.52: a picture that cannot be shown becomes a card that says
// why (src/client/mediaError.ts, drawn by src/ui/MediaErrorCard.tsx).
//
// Proven here, with no DOM: the copy chosen for every status the media route
// can answer with, the full/compact rule, that a status is read from the
// error's number and never parsed from its text, and (on source) that
// media.ts throws the status, AuthedImage and the lightbox draw the card, and
// the literal "[image unavailable]" is gone. Also on source: Fourier's portrait
// on the first page (FourierSay.tsx) is the one hosted copy.
//
// WHAT THIS CANNOT SEE: that the card looks right (tools/visual harness), or a
// real 403 from the live media gate (operator verification).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  MEDIA_ERROR_COMPACT_BELOW_PX, MEDIA_ERROR_STATUSES, MediaFetchError,
  mediaErrorCode, mediaErrorCompact, mediaErrorCopy, mediaErrorStatus,
} from '../src/client/mediaError.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = (path: string) =>
  readFileSync(join(root, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

console.log('\n-- mediaErrorCopy: one card per status --')
{
  const seen = new Set<string>()
  for (const s of MEDIA_ERROR_STATUSES) {
    const c = mediaErrorCopy(s)
    seen.add(c.title)
    check(`${s}: has a title and a body ending in a full stop`, c.title.length > 0 && /[.!]$/.test(c.body), c)
  }
  check('every listed status has its own title', seen.size === MEDIA_ERROR_STATUSES.length, seen.size)
  check('the statuses the gate realistically answers are all listed',
    [401, 403, 404, 429, 500, 502, 503, 504].every((s) => MEDIA_ERROR_STATUSES.includes(s)))
  check('403 is a refusal, and trying again cannot change it', mediaErrorCopy(403).tone === 'refused' && !mediaErrorCopy(403).retry)
  check('404 is missing, no retry', mediaErrorCopy(404).tone === 'missing' && !mediaErrorCopy(404).retry)
  check('429 says wait, and offers a retry', mediaErrorCopy(429).tone === 'later' && mediaErrorCopy(429).retry)
  check('503 is ours, retry', mediaErrorCopy(503).tone === 'ours' && mediaErrorCopy(503).retry)
  check('an unlisted 5xx (599) is still ours', mediaErrorCopy(599).tone === 'ours')
  check('an unlisted 4xx (418) gets the plain fallback', mediaErrorCopy(418).tone === 'unknown')
  check('no status gets the fallback, with a retry', mediaErrorCopy(null).tone === 'unknown' && mediaErrorCopy(null).retry)
  check('the fallback says the server gave no reason', /didn't say why/.test(mediaErrorCopy(null).body))
  check('a prototype key is not a status', mediaErrorCopy(Number('constructor')).tone === 'unknown')
  const all = [...MEDIA_ERROR_STATUSES, null].map((s) => mediaErrorCopy(s))
  check('no card carries an address, port or errcode',
    all.every((c) => !/https?:|\/\/|:\d{2,5}\b|M_[A-Z]/.test(c.title + c.body)))
  check('the code corner shows the status, or ? for none',
    mediaErrorCode(403) === '403' && mediaErrorCode(null) === '?' && mediaErrorCode(0) === '?')
}

console.log('\n-- mediaErrorCompact: chanbooru\'s threshold, unknown width is full --')
{
  check('threshold is chanbooru\'s 320', MEDIA_ERROR_COMPACT_BELOW_PX === 320)
  check('319 compact', mediaErrorCompact(319))
  check('320 full', !mediaErrorCompact(320))
  check('0 full (unknown)', !mediaErrorCompact(0))
  check('undefined full (unknown)', !mediaErrorCompact(undefined))
  check('NaN full', !mediaErrorCompact(NaN))
}

console.log('\n-- mediaErrorStatus: the number, never the text --')
{
  check('MediaFetchError carries its status', mediaErrorStatus(new MediaFetchError(403, 'x')) === 403)
  check('and is still an Error with its message', new MediaFetchError(404, 'm') instanceof Error && new MediaFetchError(404, 'm').message === 'm')
  check('a plain Error whose TEXT names a status has none', mediaErrorStatus(new Error('media fetch failed (403)')) === null)
  check('a duck-typed {status: 503} is read', mediaErrorStatus({ status: 503 }) === 503)
  for (const bad of [null, undefined, 'x', 0, { status: '403' }, { status: 99 }, { status: 600 }, { status: 403.5 }])
    check(`no status from ${JSON.stringify(bad)}`, mediaErrorStatus(bad) === null)
}

console.log('\n-- wiring, on source --')
{
  const media = code('src/client/media.ts')
  check('media.ts throws the status as a number on both fetch paths',
    (media.match(/throw new MediaFetchError\(\s*resp\.status,/g) ?? []).length === 2)
  check('and no plain Error for an HTTP failure is left',
    !/throw new Error\([^)]*resp\.status/.test(media))
  const ai = code('src/ui/AuthedImage.tsx')
  check('AuthedImage keeps the status of the failure', /setError\(\{ status: mediaErrorStatus\(err\) \}\)/.test(ai))
  check('and draws the card in the picture\'s box, with a retry',
    /<MediaErrorCard status=\{error\.status\} box=\{box\} onRetry=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\} \/>/.test(ai))
  check('a retry is a new fetch', /\[client, mxc, file, mimetype, width, roomId, near, version, attempt\]/.test(ai))
  check('the avatar fallback still wins', /if \(fallback !== undefined\) return <>\{fallback\}<\/>/.test(ai))
  const lb = code('src/ui/Lightbox.tsx')
  check('the lightbox reports the failure and keeps its status',
    /reportIgnored\('lightbox: full-size picture', err\)\s*setError\(\{ status: mediaErrorStatus\(err\) \}\)/.test(lb))
  check('and draws the card', /<MediaErrorCard status=\{error\.status\}/.test(lb))
  for (const f of ['src/ui/AuthedImage.tsx', 'src/ui/Lightbox.tsx'])
    check(`${f} no longer renders "[image unavailable]"`, !/\[image unavailable\]/.test(code(f)))
  const card = code('src/ui/MediaErrorCard.tsx')
  check('the card offers a retry only where the copy says it can help', /copy\.retry && onRetry &&/.test(card))
  check('the retry does not also open the picture', /e\.stopPropagation\(\)\s*onRetry\(\)/.test(card))
}

console.log('\n-- Fourier\'s face on the first page --')
{
  const fs = code('src/onboarding/FourierSay.tsx')
  check('the portrait is the one hosted copy the MAS pages show',
    /const FOURIER_PORTRAIT = 'https:\/\/41chan\.net\/fourier-chan\/avatar\.png'/.test(fs))
  check('drawn in her circle', /<img\s+className="fc-portrait"\s+src=\{FOURIER_PORTRAIT\}/.test(fs))
  check('a failed portrait is reported and falls back to her monogram',
    /reportIgnored\('fourier portrait'/.test(fs) && /portraitFailed \? \(\s*<span className="fc-mono">/.test(fs))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
