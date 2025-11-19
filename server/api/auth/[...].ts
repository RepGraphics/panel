import { randomUUID } from 'node:crypto'
import { NuxtAuthHandler } from '#auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { AuthOptions } from 'next-auth'
import bcrypt from 'bcryptjs'
import { defineEventHandler, getQuery, sendRedirect, type EventHandler } from 'h3'
import { useDrizzle, tables, eq, or } from '~~/server/utils/drizzle'
import { verifyRecoveryToken, verifyTotpToken } from '~~/server/utils/totp'
import type { Role, AuthCredentials as Credentials, AuthExtendedUser as ExtendedUser } from '#shared/types/auth'

const ADMIN_PANEL_PERMISSIONS = [
  'admin.users.read',
  'admin.servers.read',
  'admin.nodes.read',
  'admin.locations.read',
  'admin.eggs.read',
  'admin.mounts.read',
  'admin.database-hosts.read',
  'admin.activity.read',
  'admin.settings.read',
]

const runtimeConfig = useRuntimeConfig()
const credentialsProvider = (CredentialsProvider as unknown as { default?: typeof CredentialsProvider }).default ?? CredentialsProvider

function resolveLoginRedirect(query: Record<string, unknown>): string {
  const rawCallback = typeof query.callbackUrl === 'string' ? query.callbackUrl : undefined
  const redirectTarget = rawCallback && rawCallback.startsWith('/') ? rawCallback : '/'

  const params = new URLSearchParams()
  if (redirectTarget !== '/')
    params.set('redirect', redirectTarget)

  const error = typeof query.error === 'string' ? query.error.trim() : ''
  if (error.length > 0)
    params.set('error', error)

  const search = params.toString()
  return search.length > 0 ? `/auth/login?${search}` : '/auth/login'
}

function upsertSessionRecord(params: { sessionToken: string; userId: string; expires: Date }) {
  const { sessionToken, userId, expires } = params
  const db = useDrizzle()
  const now = new Date()

  db.insert(tables.sessions)
    .values({
      sessionToken,
      userId,
      expires,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tables.sessions.sessionToken,
      set: {
        userId,
        expires,
        updatedAt: now,
      },
    })
    .run()
}

function getSessionUserSnapshot(userId: string) {
  const db = useDrizzle()
  const dbUser = db
    .select({
      id: tables.users.id,
      username: tables.users.username,
      email: tables.users.email,
      nameFirst: tables.users.nameFirst,
      nameLast: tables.users.nameLast,
      image: tables.users.image,
      role: tables.users.role,
      rootAdmin: tables.users.rootAdmin,
      useTotp: tables.users.useTotp,
      totpAuthenticatedAt: tables.users.totpAuthenticatedAt,
    })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .get()

  if (!dbUser) {
    return null
  }

  const derivedRole: Role = dbUser.rootAdmin || dbUser.role === 'admin' ? 'admin' : 'user'
  const permissions = derivedRole === 'admin' ? ADMIN_PANEL_PERMISSIONS : []
  const name = [dbUser.nameFirst, dbUser.nameLast].filter(Boolean).join(' ') || dbUser.username

  return {
    id: dbUser.id,
    username: dbUser.username,
    email: dbUser.email,
    role: derivedRole,
    permissions,
    name,
    image: dbUser.image ?? null,
    useTotp: !!dbUser.useTotp,
    totpAuthenticatedAt: dbUser.totpAuthenticatedAt
      ? new Date(dbUser.totpAuthenticatedAt).toISOString()
      : null,
  }
}

const authHandler = NuxtAuthHandler({
  secret: runtimeConfig.authSecret,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },

  pages: {
    signIn: '/auth/login',
    error: '/auth/error',
  },

  providers: [
    credentialsProvider({
      name: 'Credentials',
      credentials: {
        identity: { label: 'Username or Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
        token: { label: 'Two-factor token', type: 'text', placeholder: '123456 or recovery token' },
      },
      async authorize(credentials: Credentials | undefined) {
        if (!credentials?.identity || !credentials?.password) {
          return null
        }

        const db = useDrizzle()

        const user = db
          .select()
          .from(tables.users)
          .where(
            or(
              eq(tables.users.username, credentials.identity),
              eq(tables.users.email, credentials.identity)
            )
          )
          .get()

        if (!user) {
          return null
        }

        const isValid = await bcrypt.compare(credentials.password, user.password)
        if (!isValid) {
          return null
        }

        if (user.useTotp) {
          const rawToken = credentials.token?.trim()
          if (!rawToken) {
            throw new Error('Two-factor authentication token required.')
          }

          const totpInput = rawToken.replaceAll(' ', '')
          const recoveryInput = rawToken.replaceAll(' ', '').toUpperCase()

          let recoveryTokenId: string | null = null
          let isTotpValid = false

          if (user.totpSecret) {
            isTotpValid = verifyTotpToken(totpInput, user.totpSecret)
          }

          if (!isTotpValid) {
            const recoveryTokens = useDrizzle()
              .select()
              .from(tables.recoveryTokens)
              .where(eq(tables.recoveryTokens.userId, user.id))
              .all()

            for (const recoveryToken of recoveryTokens) {
              if (recoveryToken.usedAt)
                continue

              const matches = await verifyRecoveryToken(recoveryInput, recoveryToken.token)
              if (matches) {
                recoveryTokenId = recoveryToken.id
                break
              }
            }

            if (!recoveryTokenId) {
              throw new Error('Invalid two-factor authentication token.')
            }
          }

          const now = new Date()
          useDrizzle()
            .update(tables.users)
            .set({ totpAuthenticatedAt: now, updatedAt: now })
            .where(eq(tables.users.id, user.id))
            .run()

          if (recoveryTokenId) {
            useDrizzle()
              .update(tables.recoveryTokens)
              .set({ usedAt: now })
              .where(eq(tables.recoveryTokens.id, recoveryTokenId))
              .run()
          }
        }

        const fullName = [user.nameFirst, user.nameLast].filter(Boolean).join(' ') || user.username
        const role = (user.role === 'admin' ? 'admin' : 'user') as Role
        const permissions = role === 'admin' || user.rootAdmin ? ADMIN_PANEL_PERMISSIONS : []
        return {
          id: user.id,
          email: user.email,
          name: fullName,
          username: user.username,
          role,
          permissions,
          useTotp: user.useTotp ?? false,
          totpAuthenticatedAt: user.totpAuthenticatedAt ?? null,
        }
      },
    }),
  ],

  callbacks: {
    async redirect({ url, baseUrl }) {
      const configuredOrigin = typeof runtimeConfig.authOrigin === 'string'
        && /^https?:\/\//.test(runtimeConfig.authOrigin)
        ? runtimeConfig.authOrigin.replace(/\/$/, '')
        : null

      const normalizedBase = configuredOrigin
        ?? (typeof baseUrl === 'string' && /^https?:\/\//.test(baseUrl)
          ? new URL(baseUrl).origin.replace(/\/$/, '')
          : 'http://localhost:3000')

      if (!url) {
        return `${normalizedBase}/`
      }

      if (url.startsWith('/')) {
        return `${normalizedBase}${url}`
      }

      try {
        const absoluteTarget = /^https?:\/\//.test(url)
          ? new URL(url)
          : new URL(url, `${normalizedBase}/`)

        if (absoluteTarget.origin === normalizedBase) {
          return absoluteTarget.toString()
        }
      }
      catch (error) {
        console.error('Invalid redirect URL', { url, baseUrl, normalizedBase, error })
      }

      return `${normalizedBase}/`
    },

    async jwt({ token, user }) {
      if (user) {
        const extendedUser = user as ExtendedUser
        token.id = extendedUser.id
        if (!token.sessionToken) {
          token.sessionToken = randomUUID()
        }

        const expiresNumeric = typeof token.exp === 'number'
          ? token.exp * 1000
          : Date.now() + (30 * 24 * 60 * 60 * 1000)

        if (extendedUser.id) {
          upsertSessionRecord({
            sessionToken: token.sessionToken as string,
            userId: extendedUser.id,
            expires: new Date(expiresNumeric),
          })
        }
      }

      if (token.id && !token.sessionToken) {
        token.sessionToken = randomUUID()
      }

      return token
    },

    async session({ session, token }) {
      if (!token?.id) {
        return null
      }

      const snapshot = getSessionUserSnapshot(token.id as string)
      if (!snapshot) {
        return null
      }

      const expiresNumeric = typeof token.exp === 'number'
        ? token.exp * 1000
        : Date.now() + (30 * 24 * 60 * 60 * 1000)

      if (token.sessionToken) {
        upsertSessionRecord({
          sessionToken: token.sessionToken as string,
          userId: snapshot.id,
          expires: new Date(expiresNumeric),
        })
      }

      const sessionUser = session.user as Record<string, unknown> | undefined
      const nextUser: Record<string, unknown> = {
        ...(sessionUser ?? {}),
        name: snapshot.name,
        email: snapshot.email,
        image: snapshot.image,
      }

      nextUser.id = snapshot.id
      nextUser.username = snapshot.username
      nextUser.role = snapshot.role
      nextUser.permissions = snapshot.permissions
      nextUser.useTotp = snapshot.useTotp
      nextUser.totpAuthenticatedAt = snapshot.totpAuthenticatedAt

      session.user = nextUser as typeof session.user

      return session
    },
  },
} as AuthOptions) as EventHandler

export default defineEventHandler(async (event) => {
  const path = event.path || event.node.req.url?.split('?')[0] || ''
  if (event.method === 'GET' && path.endsWith('/callback/credentials')) {
    const query = getQuery(event)
    const destination = resolveLoginRedirect(query as Record<string, unknown>)
    return sendRedirect(event, destination, 302)
  }

  return authHandler(event)
})
