import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendRows } from './sheets'

// Bug: rows went into the sheet as a staircase — each new row started
// further right — because Google's values:append guesses "the table" and,
// below a row beginning with empty cells, starts the next row there.
describe('appendRows', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubGoogle(tab: string[][], grid = { rowCount: 1000, columnCount: 26 }) {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const u = decodeURIComponent(String(url))
      calls.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null })
      if (u.includes('fields=sheets.properties')) {
        return new Response(JSON.stringify({ sheets: [{ properties: { sheetId: 7, title: 'Leads', gridProperties: grid } }] }))
      }
      if ((init.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ values: tab }))
      return new Response('{}')
    }))
    return calls
  }

  it('writes from column A of the row below the last filled one, never through values:append', async () => {
    // Row 3 begins with two empty cells — where Google's append went wrong.
    const calls = stubGoogle([['Date', 'Name', 'Phone'], ['2026-10-27', 'Anu', '9847'], ['', '', '9900']])
    await appendRows('t', 'sheet1', 'Leads', [['', 'Biju', '9811']])
    expect(calls.some((c) => c.url.includes(':append'))).toBe(false)
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toContain("'Leads'!A4:C4")
    // An empty cell is left as it is, not written over.
    expect(put.body).toEqual({ values: [[null, 'Biju', '9811']] })
  })

  it('starts at the row it is given, and adds rows when the grid ends', async () => {
    const calls = stubGoogle([], { rowCount: 5, columnCount: 2 })
    await appendRows('t', 'sheet1', 'Leads', [['a', 'b', 'c'], ['d', 'e', 'f']], { atRow: 5 })
    const grow = calls.find((c) => c.url.includes(':batchUpdate'))!
    expect(grow.body).toEqual({ requests: [
      { appendDimension: { sheetId: 7, dimension: 'ROWS', length: 1 } },
      { appendDimension: { sheetId: 7, dimension: 'COLUMNS', length: 1 } },
    ] })
    expect(calls.find((c) => c.method === 'PUT')!.url).toContain("'Leads'!A5:C6")
  })
})
