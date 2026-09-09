// Why a send failed, in the user's terms.
//
// Matrix errcodes are precise and useless to a person. The three that actually
// happen get their own sentence; everything else says what is known without
// pretending to know more, because "something went wrong" and a raw
// M_UNKNOWN are equally unactionable.
//
// Pure, so the harness can check every branch (O-tp9).
export function describeSendFailure(err: unknown): string {
  const e = err as { errcode?: unknown; httpStatus?: unknown; message?: unknown } | null
  const code = typeof e?.errcode === 'string' ? e.errcode : ''
  const status = typeof e?.httpStatus === 'number' ? e.httpStatus : 0

  if (code === 'M_LIMIT_EXCEEDED') {
    return 'Sending too fast -- the server asked us to wait. Try again in a moment.'
  }
  if (code === 'M_TOO_LARGE' || status === 413) {
    return 'That file is larger than this server accepts.'
  }
  if (code === 'M_FORBIDDEN' || status === 403) {
    return 'You do not have permission to post here.'
  }
  // An encrypted room that has no encryptor cannot send at all, and the SDK
  // says so in prose rather than an errcode.
  if (typeof e?.message === 'string' && /unconfigured room|encrypt/i.test(e.message)) {
    return 'This room is encrypted and encryption is not ready in this session yet. Reload and try again.'
  }
  if (status === 0 && !code) {
    return 'Could not reach the server. Your message has been kept.'
  }
  return `The server refused it${code ? ` (${code})` : ''}. Your message has been kept.`
}
