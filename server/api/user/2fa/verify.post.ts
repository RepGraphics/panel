import { createError } from 'h3'
import { APIError } from 'better-auth/api'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const auth = getAuth()
  
  const session = await auth.api.getSession({
    headers: normalizeHeadersForAuth(event.node.req.headers),
  })

  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  const body = await readBody(event)
  const { code } = body // Better Auth uses code not token

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'TOTP code is required',
    })
  }

  try {
    const api = auth.api as typeof auth.api & {
      verifyTOTP: (options: {
        body: { code: string }
        headers: Record<string, string>
      }) => Promise<unknown>
    }
    await api.verifyTOTP({
      body: {
        code,
      },
      headers: normalizeHeadersForAuth(event.node.req.headers),
    })

    await recordAuditEventFromRequest(event, {
      actor: session.user.email || session.user.id,
      actorType: 'user',
      action: 'auth.2fa.enabled',
      targetType: 'user',
      targetId: session.user.id,
    })

    return {
      success: true,
      message: '2FA enabled successfully',
    }
  }
  catch (error) {
    if (error instanceof APIError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message || 'Invalid TOTP code',
      })
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to verify TOTP code',
    })
  }
})
