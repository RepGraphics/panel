import { createError, assertMethod, setCookie, parseCookies } from 'h3'
import { APIError } from 'better-auth/api'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { resolveSessionUser } from '~~/server/utils/auth/sessionUser'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import { accountPasswordUpdateSchema } from '#shared/schema/account'

export default defineEventHandler(async (event) => {
  assertMethod(event, 'PUT')

  const auth = getAuth()
  
  const session = await auth.api.getSession({
    headers: normalizeHeadersForAuth(event.node.req.headers),
  })

  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readValidatedBody(event, payload => accountPasswordUpdateSchema.parse(payload))

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: true,
      },
      headers: normalizeHeadersForAuth(event.node.req.headers),
    })

    const { useDrizzle, tables, eq } = await import('~~/server/utils/drizzle')
    const db = useDrizzle()
    await db.update(tables.users)
      .set({
        passwordCompromised: false,
        updatedAt: new Date(),
      })
      .where(eq(tables.users.id, session.user.id))
      .run()

    const now = new Date()
    await db.update(tables.sessions)
      .set({
        updatedAt: now,
      })
      .where(eq(tables.sessions.sessionToken, session.session.token))
      .run()

    const cookies = parseCookies(event)
    const cookiePrefix = 'better-auth' 
    const sessionDataCookieName = `${cookiePrefix}.session_data`
    
    if (cookies[sessionDataCookieName]) {
      setCookie(event, sessionDataCookieName, '', {
        path: '/',
        maxAge: 0,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      })
    }

    const freshSession = await auth.api.getSession({
      headers: normalizeHeadersForAuth(event.node.req.headers),
      query: {
        disableCookieCache: true,
      },
    })

    const { useDrizzle: useDrizzleSessions, tables: tablesSessions, eq: eqSessions, and: andSessions } = await import('~~/server/utils/drizzle')
    const { ne } = await import('drizzle-orm')
    const dbSessions = useDrizzleSessions()
    const currentToken = session.session?.token || null
    
    let deletedSessions
    if (currentToken) {
      deletedSessions = await dbSessions.delete(tablesSessions.sessions)
        .where(
          andSessions(
            eqSessions(tablesSessions.sessions.userId, session.user.id),
            ne(tablesSessions.sessions.sessionToken, currentToken)
          )
        )
        .run()
    } else {
      deletedSessions = await dbSessions.delete(tablesSessions.sessions)
        .where(eqSessions(tablesSessions.sessions.userId, session.user.id))
        .run()
    }
    
    const revokedCount = typeof deletedSessions?.changes === 'number' ? deletedSessions.changes : 0

    const resolvedUser = resolveSessionUser(freshSession)
    if (resolvedUser) {
      await recordAuditEventFromRequest(event, {
        actor: resolvedUser.email || resolvedUser.id,
        actorType: 'user',
        action: 'account.password.update',
        targetType: 'user',
        targetId: resolvedUser.id,
        metadata: {
          revokedSessions: revokedCount,
        },
      })
    }

    return {
      success: true,
      revokedSessions: revokedCount,
    }
  }
  catch (error) {
    if (error instanceof APIError) {
      const errorMessage = error.message?.toLowerCase() || ''
      if (errorMessage.includes('compromised') || errorMessage.includes('pwned')) {
        const { useDrizzle, tables, eq } = await import('~~/server/utils/drizzle')
        const db = useDrizzle()
        await db.update(tables.users)
          .set({
            passwordCompromised: true,
            updatedAt: new Date(),
          })
          .where(eq(tables.users.id, session.user.id))
          .run()
      }
      
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message || 'Failed to change password',
      })
    }
    throw createError({
      statusCode: 400,
      statusMessage: 'Failed to change password',
    })
  }
})
