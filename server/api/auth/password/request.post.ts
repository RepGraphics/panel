import { createError } from 'h3'
import { APIError } from 'better-auth/api'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { useDrizzle, tables, eq, or } from '~~/server/utils/drizzle'
import { resolvePanelBaseUrl } from '~~/server/utils/email'

interface RequestBody {
  identity?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RequestBody>(event)

  const identity = body.identity?.trim().toLowerCase()

  if (!identity) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Username or email required',
    })
  }

  const db = useDrizzle()
  const user = db
    .select({ id: tables.users.id, email: tables.users.email })
    .from(tables.users)
    .where(or(eq(tables.users.email, identity), eq(tables.users.username, identity)))
    .get()

  if (!user?.email) {
    return {
      success: true,
      message: 'If an account matches, a password reset email has been sent.',
    }
  }

  const auth = getAuth()
  const resetBaseUrl = `${resolvePanelBaseUrl()}/auth/password/reset`
  
  try {
    await auth.api.requestPasswordReset({
      body: {
        email: user.email,
        redirectTo: resetBaseUrl,
      },
      headers: normalizeHeadersForAuth(event.node.req.headers),
    })
  }
  catch (error) {
    if (error instanceof APIError) {
      console.error('Failed to send password reset email', {
        status: error.statusCode,
        message: error.message,
      })
    }
    else {
      console.error('Failed to send password reset email', error)
    }
  }

  return {
    success: true,
    message: 'If an account matches, a password reset email has been sent.',
  }
})
