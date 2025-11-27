import { createError } from 'h3'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const auth = getAuth()
  
  const session = await auth.api.getSession({
    headers: normalizeHeadersForAuth(event.node.req.headers),
  })

  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

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

  const { parseCookies, setCookie } = await import('h3')
  const cookies = parseCookies(event)
  const sessionDataCookieName = 'better-auth.session_data'
  
  if (cookies[sessionDataCookieName]) {
    setCookie(event, sessionDataCookieName, '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
  }

  return {
    success: true,
    message: 'Password compromised flag cleared',
    passwordCompromised: false,
  }
})

