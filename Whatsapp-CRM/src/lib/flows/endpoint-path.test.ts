import { describe, expect, it } from 'vitest'
import { flowEndpointRewrite } from './endpoint-path'

// Bug: Meta's Flow health check failed with "Status code: 307, Body:
// /login?callbackUrl=/flows/<id>". The endpoint URI saved on Meta was the
// Flow's editor page in the CRM (/flows/<id>, the address in the browser
// bar) instead of /api/flows/<id>/webhook. That page needs a login, so
// Meta's server — which has none — was redirected to the sign-in page,
// and every real customer would have seen the Flow fail to load.

const ID = '6b95f512-86a9-4b94-ad50-1bca345f01e5'
const none = new Headers()

describe("a Flow request sent to the editor page's address", () => {
  it("is passed to the Flow's endpoint instead of the login page", () => {
    expect(flowEndpointRewrite('POST', `/flows/${ID}`, none)).toBe(`/api/flows/${ID}/webhook`)
    expect(flowEndpointRewrite('POST', `/flows/${ID}/`, none)).toBe(`/api/flows/${ID}/webhook`)
  })

  it('leaves people opening the page alone', () => {
    expect(flowEndpointRewrite('GET', `/flows/${ID}`, none)).toBeNull()
    expect(flowEndpointRewrite('HEAD', `/flows/${ID}`, none)).toBeNull()
  })

  it("leaves the page's own server actions alone", () => {
    expect(flowEndpointRewrite('POST', `/flows/${ID}`, new Headers({ 'next-action': 'abc' }))).toBeNull()
  })

  it('touches nothing else — not runs, not new, not a non-id', () => {
    expect(flowEndpointRewrite('POST', `/flows/${ID}/runs`, none)).toBeNull()
    expect(flowEndpointRewrite('POST', '/flows/new', none)).toBeNull()
    expect(flowEndpointRewrite('POST', '/flows/../api/x', none)).toBeNull()
    expect(flowEndpointRewrite('POST', `/inbox/${ID}`, none)).toBeNull()
  })
})
