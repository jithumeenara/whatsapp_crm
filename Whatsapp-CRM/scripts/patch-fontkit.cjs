// Idempotent one-line fix for fontkit 2.0.4 (the latest on npm).
//
// A NULL anchor offset in a GPOS mark-to-base table is legal OpenType ("no
// attachment"), but fontkit dereferences it and throws "Cannot read properties
// of null (reading 'xCoordinate')" for every Noto Sans Malayalam word that ends
// in a virama (ലീഡ്, ചെലവ്, ...). That would make the Malayalam report PDF crash.
//
// Runs from npm's postinstall, so `npm ci` on the server applies it too.
// src/lib/reports/pdf/fontkit-patch.test.ts fails if it was not applied.
const fs = require('fs')
const path = require('path')

const MARK = 'PATCH: NULL anchor'
const FROM = 'applyAnchor(markRecord, baseAnchor, baseGlyphIndex) {'
const TO = `applyAnchor(markRecord, baseAnchor, baseGlyphIndex) {
        if (!baseAnchor || !markRecord.markAnchor) return; // ${MARK} offset is legal OpenType = no attachment`

// Resolved from this file, not through require.resolve (fontkit's "exports"
// do not expose package.json).
const dist = path.join(__dirname, '..', 'node_modules', 'fontkit', 'dist')
if (!fs.existsSync(dist)) process.exit(0) // fontkit is not installed (a partial install): nothing to patch

for (const file of ['main.cjs', 'module.mjs']) {
  const p = path.join(dist, file)
  if (!fs.existsSync(p)) continue
  const src = fs.readFileSync(p, 'utf8')
  if (src.includes(MARK)) continue
  if (!src.includes(FROM)) {
    console.warn(`[patch-fontkit] ${file}: expected code not found (a newer fontkit?): not patched`)
    continue
  }
  fs.writeFileSync(p, src.replace(FROM, TO))
  console.log(`[patch-fontkit] ${file} patched`)
}
