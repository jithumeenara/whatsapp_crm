// Run: node scripts/fix-flow-mapping.mjs
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FLOW_ID = '9193042e-eb71-4061-a7e3-e3090fba228d'

// 1. Load current trigger_config
const flow = await prisma.flow.findUnique({
  where: { id: FLOW_ID },
  select: { trigger_config: true, name: true },
})
if (!flow) { console.error('Flow not found'); process.exit(1) }

const cfg = flow.trigger_config

// 2. Find the Registration table
const table = await prisma.dataTable.findFirst({
  where: { name: 'Registration' },
  select: { id: true, fields: { select: { field_key: true, label: true } } },
})
if (!table) { console.error('Registration table not found'); process.exit(1) }
console.log('Registration table id:', table.id)
console.log('Fields:', table.fields)

// 3. Apply _save_table_id and _save_field_key to the screens
const FIELD_MAP = {
  'input_comp_433':    'student_name',
  'date_comp_579':     'date_of_birth',
  'dropdown_comp_562': 'course_selected',
}

function patchComponents(components) {
  return components.map(comp => {
    const mapped = FIELD_MAP[comp.name]
    if (mapped) return { ...comp, _save_field_key: mapped }
    return comp
  })
}

const patchedScreens = cfg.screens.map(screen => ({
  ...screen,
  components: patchComponents(screen.components ?? []),
}))

const newCfg = {
  ...cfg,
  _save_table_id: table.id,
  screens: patchedScreens,
}

// 4. Save back
await prisma.flow.update({
  where: { id: FLOW_ID },
  data: { trigger_config: newCfg },
})

// 5. Verify
console.log('\n✓ Updated trigger_config:')
console.log('  _save_table_id:', newCfg._save_table_id)
for (const screen of patchedScreens) {
  for (const comp of screen.components ?? []) {
    if (comp._save_field_key) {
      console.log(`  ${comp.name} → ${comp._save_field_key}`)
    }
  }
}

await prisma.$disconnect()
console.log('\nDone. Submit the flow again to test.')
