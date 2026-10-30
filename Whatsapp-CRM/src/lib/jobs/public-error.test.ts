import { describe, expect, it, vi } from 'vitest'
import { publicErrorMessage } from './public-error'

describe('publicErrorMessage', () => {
  it('passes a message written for the user through', () => {
    expect(publicErrorMessage(new Error('This table has no rows to train on yet.'), 'x')).toBe('This table has no rows to train on yet.')
  })
  it('hides database and library text', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const prismaish = Object.assign(new Error('Invalid `prisma.dataTable.findFirst()` invocation: column "x" does not exist'), { name: 'PrismaClientKnownRequestError' })
    expect(publicErrorMessage(prismaish, 'Could not train this table.')).toBe('Could not train this table.')
    expect(publicErrorMessage(new Error('connect ECONNREFUSED 10.0.0.5:5432'), 'F')).toBe('F')
    expect(publicErrorMessage(new TypeError("Cannot read properties of undefined (reading 'x')"), 'F')).toBe('F')
    expect(publicErrorMessage(new Error("ENOENT: no such file or directory, open '/srv/app/uploads/a'"), 'F')).toBe('F')
    expect(publicErrorMessage('a string', 'F')).toBe('F')
  })
})
