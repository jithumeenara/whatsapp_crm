import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { STATIC_MOMENTS, storeMoment } from '@/lib/reports/moments'
import { loadContext } from '@/lib/reports/engine'
import { PRESETS, PRESET_LABEL } from '@/lib/reports/period'
import { PRESET_REPORTS, dataStorePresets } from '@/lib/reports/presets'
import { listSaved } from '@/lib/reports/store'

/**
 * GET /api/reports/catalog
 *
 * Everything the report builder offers this account: the moments (fixed
 * ones plus one per Data Store table), what each can be split by and add
 * up, the periods, the ready reports and the saved ones.
 *
 * Supervisors and above: a report is account-wide, and agents see only
 * their own leads everywhere else.
 */
export async function GET() {
  try {
    const ctx = await requirePageAccess('/reports', 'supervisor')
    const rc = await loadContext(ctx.accountId)
    const moments = [...STATIC_MOMENTS, ...rc.store.map(storeMoment)].map((m) => ({
      kind: m.kind,
      label: m.label,
      group: m.group,
      props: m.props.map((p) => ({ key: p.key, label: p.label })),
      values: m.values.map((v) => ({ key: v.key, label: v.label, unit: v.unit ?? null })),
    }))
    const saved = await listSaved(ctx.accountId)
    return NextResponse.json({
      moments,
      periods: PRESETS.map((p) => ({ key: p, label: PRESET_LABEL[p] })),
      presets: [...PRESET_REPORTS, ...dataStorePresets(rc.store)],
      saved: saved.map((s) => ({ id: s.id, name: s.name, spec: s.spec, updated_at: s.updated_at })),
      timezone: rc.timezone,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
