import { describe, it, expect } from 'vitest'
import { selectRelevantContext, formatKnowledgeBlock, widenToWholeSources, chunkDocument } from './knowledge'

// The Training table from the screenshot, serialized the way
// data-store-source.ts does it: a header block, then one block per record.
const TRAINING = {
  id: 'training-table',
  title: 'Training',
  content: [
    'TABLE: Training\nFIELDS: Name of programme, Target group, Month, Date from, Date To, Fee\nEach block below is one record from this table.',
    'Name of programme: Statutory Training Programme (STP) (S)\nTarget group: Sub-staff\nMonth: september\nDate from: 2026-09-29\nDate To: 2026-10-01\nFee: 3540',
    'Name of programme: Statutory Training Programme (STP) (M)\nTarget group: Ministerial Cadre\nMonth: october\nDate from: 2026-10-12\nDate To: 2026-10-16\nFee: 5900',
    'Name of programme: Gold loan Appraisal and Prevention of Fraud\nTarget group: All categories of Staff\nMonth: october\nDate from: 2026-10-16\nDate To: 2026-10-17\nFee: 2360',
    'Name of programme: Statutory Training Programme (STP) (SV)\nTarget group: Supervisory Cadre\nMonth: october\nDate from: 2026-10-26\nDate To: 2026-10-31\nFee: 7080',
  ].join('\n\n'),
}

function bigTable(id: string, records: number) {
  const blocks = ['TABLE: Branches\nFIELDS: Branch, Address\nEach block below is one record from this table.']
  for (let i = 0; i < records; i++) {
    blocks.push(`Branch: Training centre ${i}\nAddress: ${'Building '.repeat(20)}${i}, Thiruvananthapuram`)
  }
  return { id, title: 'Branches', content: blocks.join('\n\n') }
}

describe('a matched short table is given whole', () => {
  it('lists every programme, not only the ones named like the question', async () => {
    const selected = await selectRelevantContext('What training programmes do you have?', [], [TRAINING], { maxDocChunks: 3 })
    const block = formatKnowledgeBlock(selected)
    expect(block).toContain('Gold loan Appraisal')
    expect(block).toContain('(complete — everything in this source is below)')
    expect(block).not.toContain('PARTIAL')
    // The header comes first and records keep their table order.
    expect(selected.documentChunks[0].text.startsWith('TABLE: Training')).toBe(true)
    expect(selected.documentChunks).toHaveLength(5)
    expect(selected.sourceTotals).toEqual({ 'training-table': 5 })
  })

  it('reproduces the cut it replaces: three best passages leave Gold out', () => {
    const all = chunkDocument(TRAINING)
    const threeStp = all.filter((c) => c.text.includes('Statutory'))
    expect(threeStp.map((c) => c.text).join()).not.toContain('Gold')
    const widened = widenToWholeSources(threeStp, all)
    expect(widened.documentChunks.map((c) => c.text).join()).toContain('Gold loan Appraisal')
  })

  it('leaves an unmatched source out entirely', async () => {
    const selected = await selectRelevantContext('refund policy', [], [TRAINING], { maxDocChunks: 3 })
    expect(selected.documentChunks).toHaveLength(0)
  })
})

describe('a long table is given in part, and says so', () => {
  it('keeps the matched records plus the header, marked partial', async () => {
    const table = bigTable('branches', 120)
    const selected = await selectRelevantContext('Training centre 7 address', [], [table], { maxDocChunks: 3 })
    const block = formatKnowledgeBlock(selected)
    expect(block).toContain('PARTIAL')
    expect(block).toContain('Do not present this as a complete list')
    expect(selected.documentChunks[0].text.startsWith('TABLE: Branches')).toBe(true)
    expect(selected.documentChunks).toHaveLength(4)
    expect(selected.sourceTotals?.branches).toBe(121)
  })

  it('stops giving sources whole once the budget is spent', () => {
    const docs = ['a', 'b', 'c'].map((id) => ({ id, title: id, content: [`${id} one ${'x'.repeat(4990)}`, `${id} two ${'y'.repeat(4990)}`].join('\n\n') }))
    const all = docs.flatMap((d) => chunkDocument(d, 5000))
    const firstOfEach = docs.map((d) => all.find((c) => c.sourceId === d.id)!)
    const { documentChunks } = widenToWholeSources(firstOfEach, all)
    const count = (id: string) => documentChunks.filter((c) => c.sourceId === id).length
    expect([count('a'), count('b'), count('c')]).toEqual([2, 2, 1])
  })
})
