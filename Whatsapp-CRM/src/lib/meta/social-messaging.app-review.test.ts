import { describe, expect, it } from 'vitest'
import { explainMetaError } from './social-messaging'

/**
 * Seen live 2026-11-22: a Messenger reply failed with "(#10) Cannot message
 * users who are not admins, developers or testers of the app until
 * pages_messaging permission is reviewed and the app is live." The screen
 * only said "Meta refused the request (code 10)".
 */
describe('explainMetaError — App Review not done yet', () => {
  it('says plainly who can be replied to and what to do, without Meta’s own text', () => {
    const text = explainMetaError({ code: 10, message: 'Cannot message users who are not admins, developers or testers of the app until pages_messaging permission is reviewed and the app is live.' }, 400)
    expect(text).toMatch(/Tester/)
    expect(text).toMatch(/App Review/)
    expect(text).not.toMatch(/\(#10\)|pages_messaging permission is reviewed/)
  })
  it('other code 10 errors keep their own meaning', () => {
    expect(explainMetaError({ code: 10, error_subcode: 2018278 }, 400)).toMatch(/reply window/)
  })
})
