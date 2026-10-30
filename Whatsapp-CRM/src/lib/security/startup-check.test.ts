import { describe, expect, it } from 'vitest'
import { checkStartupEnv, isDevServer } from './startup-check'

const GOOD = {
  NODE_ENV: 'production',
  NEXTAUTH_SECRET: 'k3J9vQ2mX8pL5rT1wZ7yB4nC6dF0gH2jK9sA3eU5iO8',
  ENCRYPTION_KEY: 'a'.repeat(32) + '0123456789abcdef0123456789ABCDEF',
}

describe('isDevServer', () => {
  it('runs Next in development only when NODE_ENV says development', () => {
    expect(isDevServer({ NODE_ENV: 'development' })).toBe(true)
    // Unset was dev mode: non-Secure cookies and stack traces in production.
    expect(isDevServer({})).toBe(false)
    expect(isDevServer({ NODE_ENV: '' })).toBe(false)
    expect(isDevServer({ NODE_ENV: 'production' })).toBe(false)
    expect(isDevServer({ NODE_ENV: 'test' })).toBe(false)
  })

  it('keeps `npm run dev` a development server, and `npm start` not', () => {
    // package.json runs both as plain `tsx server.ts` with no NODE_ENV;
    // npm says which script it is running.
    expect(isDevServer({ npm_lifecycle_event: 'dev' })).toBe(true)
    expect(isDevServer({ npm_lifecycle_event: 'start' })).toBe(false)
    // An explicit NODE_ENV always wins.
    expect(isDevServer({ npm_lifecycle_event: 'dev', NODE_ENV: 'production' })).toBe(false)
    expect(checkStartupEnv({ npm_lifecycle_event: 'dev' }).errors).toEqual([])
  })
})

describe('checkStartupEnv', () => {
  it('accepts a properly configured production server', () => {
    expect(checkStartupEnv(GOOD)).toEqual({ errors: [], warnings: [] })
  })

  it.each([
    ['missing', { NEXTAUTH_SECRET: undefined }],
    ['short', { NEXTAUTH_SECRET: 'tooshort' }],
    ['placeholder', { NEXTAUTH_SECRET: 'generate-a-long-random-string' }],
    ['placeholder padded', { NEXTAUTH_SECRET: 'changeme-changeme-changeme-changeme' }],
  ])('refuses a %s NEXTAUTH_SECRET in production', (_label, patch) => {
    const { errors } = checkStartupEnv({ ...GOOD, ...patch })
    expect(errors.join(' ')).toContain('NEXTAUTH_SECRET')
  })

  it('judges AUTH_SECRET too when it is set', () => {
    expect(checkStartupEnv({ ...GOOD, AUTH_SECRET: 'short' }).errors.join(' ')).toContain('AUTH_SECRET')
  })

  it.each([
    ['missing', undefined],
    ['short', 'abcdef'],
    ['not hex', 'z'.repeat(64)],
    ['all zeros', '0'.repeat(64)],
  ])('refuses a %s ENCRYPTION_KEY in production', (_label, value) => {
    expect(checkStartupEnv({ ...GOOD, ENCRYPTION_KEY: value }).errors.join(' ')).toContain('ENCRYPTION_KEY')
  })

  it('never puts a secret value in a message', () => {
    const secret = 'generate-a-long-random-string'
    const { errors, warnings } = checkStartupEnv({ ...GOOD, NEXTAUTH_SECRET: secret, ENCRYPTION_KEY: 'zz' })
    for (const line of [...errors, ...warnings]) {
      expect(line).not.toContain(secret)
      expect(line).not.toContain('zz')
    }
  })

  it('warns about development switches left on in production', () => {
    expect(checkStartupEnv({ ...GOOD, APP_ENV: 'development' }).warnings.join(' ')).toContain('APP_ENV')
    expect(checkStartupEnv({ ...GOOD, META_SOCIAL_SIGNATURE: 'observe' }).warnings.join(' ')).toContain(
      'META_SOCIAL_SIGNATURE',
    )
  })

  it('treats an unset NODE_ENV as production', () => {
    expect(checkStartupEnv({ ...GOOD, NODE_ENV: undefined, NEXTAUTH_SECRET: undefined }).errors).not.toEqual([])
  })

  it('does not block a development laptop', () => {
    expect(checkStartupEnv({ NODE_ENV: 'development' }).errors).toEqual([])
  })
})
