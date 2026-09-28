/**
 * Runs the accuracy tests from the command line — on the server, after a
 * build and before the restart, so a change that makes the assistant
 * worse is caught before customers get it.
 *
 *   npx tsx --env-file=.env scripts/ai-eval.ts
 *
 * Every account that has enabled tests is run against the code on disk
 * and its own knowledge and settings; nothing is sent to anybody. The
 * exit code is 1 when an account scores lower than on its previous run,
 * so it can sit in a deploy chain:
 *
 *   npm run build && npx tsx --env-file=.env scripts/ai-eval.ts && pm2 restart 0
 *
 * Costs what the same number of real replies costs, plus grading.
 */

import { prisma } from '../src/lib/db'
import { runEvalSuite } from '../src/lib/ai/eval/runner'
import { ensureEvalColumns } from '../src/lib/ai/eval/schema'

async function main() {
  await ensureEvalColumns()
  const configs = await prisma.aiConfig.findMany({
    where: { eval_cases: { some: { enabled: true } } },
    select: { id: true, account_id: true, account: { select: { name: true } } },
  })
  if (configs.length === 0) {
    console.log('No account has accuracy tests yet. Add some under AI Config → Accuracy.')
    return
  }

  let worse = false
  for (const c of configs) {
    const previous = await prisma.aiEvalRun.findFirst({
      where: { ai_config_id: c.id, status: 'completed' },
      orderBy: { started_at: 'desc' },
      select: { passed: true, total: true },
    })
    const run = await runEvalSuite({ accountId: c.account_id, aiConfigId: c.id, label: 'deploy check' })
    const rate = run.total ? Math.round((run.passed / run.total) * 100) : 0
    const before = previous && previous.total ? Math.round((previous.passed / previous.total) * 100) : null
    const name = c.account?.name ?? c.account_id
    const change = before === null ? 'first run' : rate === before ? 'no change' : `${rate > before ? '+' : ''}${rate - before} vs last run`
    console.log(`${name}: ${run.passed}/${run.total} passed (${rate}%) — ${change}`)
    if (before !== null && rate < before) worse = true
  }

  if (worse) {
    console.log('\nAn account scored lower than before. Open AI Config → Accuracy to see which tests failed.')
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('The accuracy run failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
