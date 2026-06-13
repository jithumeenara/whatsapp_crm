// Run: node scripts/check-flow-mapping.mjs
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FLOW_ID = '9193042e-eb71-4061-a7e3-e3090fba228d'

const flow = await prisma.flow.findUnique({
  where: { id: FLOW_ID },
  select: { id: true, name: true, trigger_config: true },
})

if (!flow) { console.error('Flow not found'); process.exit(1) }

const cfg = flow.trigger_config
console.log('\n=== FLOW:', flow.name, '===')
console.log('_save_table_id:', cfg?._save_table_id ?? '❌ NOT SET')
console.log('screens count:', cfg?.screens?.length ?? 0)

for (const screen of (cfg?.screens ?? [])) {
  console.log('\n  Screen:', screen.id, '-', screen.title)
  for (const comp of (screen.components ?? [])) {
    if (['TextInput','TextArea','Dropdown','RadioButtonsGroup','CheckboxGroup','DatePicker'].includes(comp.type)) {
      console.log(`    [${comp.type}] name="${comp.name}" _save_field_key="${comp._save_field_key ?? '❌ NOT SET'}"`)
    }
  }
}

// Check if any records were saved to the registration table
if (cfg?._save_table_id) {
  const count = await prisma.dataRecord.count({ where: { table_id: cfg._save_table_id } })
  console.log('\nRecords in table:', count)
}

await prisma.$disconnect()
