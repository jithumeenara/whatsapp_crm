import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Every route that accepts a file (reads formData) has a rate limit, so a
 * script or a stuck page cannot fill the disk. A new upload route without
 * one fails here.
 */

const API = path.join(process.cwd(), 'src', 'app', 'api')

function routes(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) routes(p, out)
    else if (e.name === 'route.ts') out.push(p)
  }
  return out
}

describe('upload routes are rate-limited', () => {
  it('every route that reads formData() calls checkRateLimit', () => {
    const missing = routes(API)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('formData()'))
      .filter((f) => !fs.readFileSync(f, 'utf8').includes('checkRateLimit'))
      .map((f) => path.relative(API, f).split(path.sep).join('/'))
    expect(missing).toEqual([])
  }, 120_000)
})
