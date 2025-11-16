import type { Session } from 'next-auth'
import { describe, it, expect } from 'vitest'
import { createUserSchema } from '../../server/schemas/admin'
import { resolveSessionUser } from '../../server/utils/auth/sessionUser'
import { getSessionUser, isAdmin } from '../../server/utils/session'

const basePayload = {
  username: 'new-admin',
  email: 'admin@example.com',
  password: 'supersafepass',
  name: 'New Admin',
  role: 'admin' as const,
}

function buildSession(
  overrides: Partial<Session['user']> & {
    id?: string
    username?: string
    role?: 'admin' | 'user'
    permissions?: string[]
    remember?: string | null
  } = {},
): Session {
  const user = {
    name: overrides.name ?? null,
    email: overrides.email ?? null,
    image: overrides.image ?? null,
    ...overrides,
  }

  return { user } as Session
}

describe('Admin create user schema', () => {
  it('accepts a valid payload and infers defaults', () => {
    const result = createUserSchema.parse(basePayload)

    expect(result).toEqual({
      ...basePayload,
      role: 'admin',
    })
  })

  it('rejects invalid payloads', () => {
    const invalid = {
      ...basePayload,
      email: 'not-an-email',
      password: 'short',
    }

    const parsed = createUserSchema.safeParse(invalid)

    expect(parsed.success).toBe(false)
    if (parsed.success) {
      return
    }

    expect(parsed.error.issues.map(issue => issue.path.join('.'))).toContain('email')
    expect(parsed.error.issues.map(issue => issue.path.join('.'))).toContain('password')
  })
})

describe('resolveSessionUser utility', () => {
  it('returns null when session or required fields are missing', () => {
    expect(resolveSessionUser(null)).toBeNull()

    const sessionWithoutFields = buildSession()
    expect(resolveSessionUser(sessionWithoutFields)).toBeNull()
  })

  it('maps a valid next-auth session user into resolved shape', () => {
    const session = buildSession({
      id: 'user-123',
      username: 'test-user',
      role: 'admin',
      name: 'Test User',
      email: 'user@example.com',
      permissions: ['users:create'],
    })

    const resolved = resolveSessionUser(session)

    expect(resolved).toEqual({
      id: 'user-123',
      email: 'user@example.com',
      name: 'Test User',
      username: 'test-user',
      role: 'admin',
      permissions: ['users:create'],
    })
  })
})

describe('getSessionUser utility', () => {
  it('returns null when session is missing user details', () => {
    expect(getSessionUser(null)).toBeNull()
    const incomplete = buildSession({ id: 'user-1' })
    expect(getSessionUser(incomplete)).toBeNull()
  })

  it('normalizes optional fields with defaults', () => {
    const session = buildSession({
      id: 'user-2',
      username: 'playerOne',
      role: 'user',
    })

    const user = getSessionUser(session)

    expect(user).toEqual({
      id: 'user-2',
      username: 'playerOne',
      role: 'user',
      permissions: [],
      email: null,
      name: null,
      image: null,
      remember: null,
    })
  })

  it('preserves provided optional fields', () => {
    const session = buildSession({
      id: 'user-3',
      username: 'mod',
      role: 'user',
      permissions: ['server.view'],
      email: 'mod@example.com',
      name: 'Moderator',
      image: 'https://example.com/avatar.png',
      remember: 'session-token',
    })

    const user = getSessionUser(session)

    expect(user).toEqual({
      id: 'user-3',
      username: 'mod',
      role: 'user',
      permissions: ['server.view'],
      email: 'mod@example.com',
      name: 'Moderator',
      image: 'https://example.com/avatar.png',
      remember: 'session-token',
    })
  })
})

describe('isAdmin utility', () => {
  it('returns false for missing session or non-admin role', () => {
    expect(isAdmin(null)).toBe(false)
    const userSession = buildSession({ id: 'user-4', username: 'user', role: 'user' })
    expect(isAdmin(userSession)).toBe(false)
  })

  it('returns true when session user has admin role', () => {
    const adminSession = buildSession({ id: 'admin-1', username: 'admin', role: 'admin' })
    expect(isAdmin(adminSession)).toBe(true)
  })
})
