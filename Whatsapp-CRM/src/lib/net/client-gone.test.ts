import { describe, it, expect } from 'vitest'
import { isClientGone } from './client-gone'

/** What Node hands the handler when a browser abandons a request. */
function nodeError(code: string, message = 'aborted') {
  const err = new Error(message) as Error & { code: string }
  err.code = code
  return err
}

describe('isClientGone', () => {
  it('recognises the abort this was written for', () => {
    // The exact shape from the production log:
    //   [uncaughtException] Error: aborted
    //       at abortIncoming (node:_http_server:796:17)
    //     code: 'ECONNRESET'
    expect(isClientGone(nodeError('ECONNRESET', 'aborted'))).toBe(true)
  })

  it('recognises the other ways a caller leaves', () => {
    for (const code of ['ECONNABORTED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE']) {
      expect(isClientGone(nodeError(code))).toBe(true)
    }
  })

  describe('what it must never swallow', () => {
    // A CRM that quietly ignores a real fault sends nothing and says
    // nothing. Each of these has to reach the log.
    it('ignores no ordinary error', () => {
      expect(isClientGone(new Error('Cannot read properties of undefined'))).toBe(false)
      expect(isClientGone(new TypeError('x is not a function'))).toBe(false)
    })

    it('does not match on the message alone', () => {
      // The word is the same; the cause is not. Only `code` decides.
      expect(isClientGone(new Error('aborted'))).toBe(false)
      expect(isClientGone(new Error('connection reset by peer'))).toBe(false)
    })

    it('does not match neighbouring network codes', () => {
      // These say something is wrong with us or with a dependency —
      // a database that will not accept connections, a DNS failure —
      // not that a browser navigated away.
      for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EACCES']) {
        expect(isClientGone(nodeError(code))).toBe(false)
      }
    })

    it('does not match a non-string code', () => {
      const err = new Error('odd') as Error & { code: unknown }
      err.code = 500
      expect(isClientGone(err)).toBe(false)
    })
  })

  it('survives anything at all being thrown', () => {
    // `throw 'a string'` is legal, and an uncaughtException handler has
    // to cope with it rather than becoming the next crash.
    expect(isClientGone(null)).toBe(false)
    expect(isClientGone(undefined)).toBe(false)
    expect(isClientGone('ECONNRESET')).toBe(false)
    expect(isClientGone(42)).toBe(false)
    expect(isClientGone({})).toBe(false)
  })
})
