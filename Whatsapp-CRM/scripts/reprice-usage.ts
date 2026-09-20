/**
 * Recompute what past AI calls cost, now that the prices are right.
 *
 * ── Why history needs touching at all ───────────────────────────────
 *
 * Cost is worked out once, when the call happens, and stored. That is
 * the correct design — it means a row keeps the price that applied on
 * the day, and a historical total does not shift under anyone. It also
 * means that when the price table itself was wrong, every row written
 * while it was wrong is wrong, and stays wrong.
 *
 * It was wrong by five to twenty times, on every model, for as long as
 * this tab has existed. So a month-to-date total on the Usage tab is
 * currently a fifth of the truth, and no amount of fixing the table
 * going forward changes that.
 *
 * ── Why this is safe ────────────────────────────────────────────────
 *
 * Token counts come from Google's own response and were always exact —
 * only the multiplication was wrong. So this is arithmetic on data that
 * was never in doubt, not a guess about what happened.
 *
 * It reprices through `estimateCostUsd` rather than reimplementing the
 * rates in SQL, so there is one set of prices in this codebase and this
 * script cannot drift from the app. Each row is priced at its own
 * `created_at`, which is what keeps the promotional Flash rate on rows
 * from before January 2027 and the higher rate on rows after it.
 *
 * Rows whose cost was not derived from tokens are left alone: Google
 * Cloud TTS is billed per character and its cost was passed in
 * directly, so recomputing it from a token count of zero would quietly
 * erase it.
 *
 *   npx tsx scripts/reprice-usage.ts            # report only
 *   npx tsx scripts/reprice-usage.ts --apply    # write the changes
 */

import { PrismaClient } from '@prisma/client'
import { estimateCostUsd, PRICES_CHECKED_ON } from '../src/lib/ai/pricing'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const BATCH = 500

async function main() {
  console.log(`Prices as checked on ${PRICES_CHECKED_ON}`)
  console.log(APPLY ? 'APPLYING changes.\n' : 'Dry run — nothing will be written. Pass --apply to write.\n')

  let cursor: string | undefined
  let seen = 0
  let changed = 0
  let oldTotal = 0
  let newTotal = 0
  const byModel = new Map<string, { rows: number; before: number; after: number }>()

  for (;;) {
    const rows = await prisma.aiUsageEvent.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        model: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true,
        cost_usd: true,
        created_at: true,
      },
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id

    for (const row of rows) {
      seen += 1

      // Billed per character, not per token — its cost was supplied
      // directly and there is nothing here to recompute from.
      if (row.input_tokens === 0 && row.output_tokens === 0) continue

      const before = Number(row.cost_usd)
      const after = estimateCostUsd(
        row.model,
        {
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          totalTokens: row.total_tokens,
        },
        row.created_at,
      )

      oldTotal += before
      newTotal += after

      const m = byModel.get(row.model) ?? { rows: 0, before: 0, after: 0 }
      m.rows += 1
      m.before += before
      m.after += after
      byModel.set(row.model, m)

      // 6dp is the column's precision; anything smaller is not a
      // difference the database can hold.
      if (Math.abs(after - before) < 0.000001) continue
      changed += 1

      if (APPLY) {
        await prisma.aiUsageEvent.update({ where: { id: row.id }, data: { cost_usd: after } })
      }
    }
  }

  console.log('model'.padEnd(34) + 'rows'.padStart(7) + 'was $'.padStart(12) + 'now $'.padStart(12) + '   x')
  for (const [model, m] of [...byModel.entries()].sort((a, b) => b[1].after - a[1].after)) {
    const factor = m.before > 0 ? (m.after / m.before).toFixed(1) + 'x' : '—'
    console.log(
      model.padEnd(34) +
        String(m.rows).padStart(7) +
        m.before.toFixed(4).padStart(12) +
        m.after.toFixed(4).padStart(12) +
        '   ' +
        factor,
    )
  }

  // "would change" after a run that changed them is a small lie, and
  // a script that reports its dry run as its result is how somebody
  // ends up applying the same correction twice.
  console.log(`\n${seen} rows read, ${changed} ${APPLY ? 'changed' : 'would change'}.`)
  console.log(`Total was $${oldTotal.toFixed(4)}, is now $${newTotal.toFixed(4)}.`)
  if (!APPLY && changed > 0) console.log('\nNothing written. Re-run with --apply to keep these numbers.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
