import { createError } from 'h3'
import { APIError } from 'better-auth/api'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'

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
  const { password } = body

  if (!password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Password is required to enable 2FA',
    })
  }

  try {
    const api = auth.api as typeof auth.api & {
      enableTwoFactor: (options: {
        body: { password: string }
        headers: Record<string, string>
      }) => Promise<{ totpURI?: string; backupCodes?: string[] }>
    }
    const result = await api.enableTwoFactor({
      body: {
        password,
      },
      headers: normalizeHeadersForAuth(event.node.req.headers),
    })

    const secretFromUri = result.totpURI ? result.totpURI.split('secret=')[1]?.split('&')[0] : null
    
    return {
      uri: result.totpURI,
      secret: secretFromUri || '',
      recoveryTokens: result.backupCodes || [],
      backupCodes: result.backupCodes || [],
    }
  }
  catch (error) {
    if (error instanceof APIError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message || 'Failed to enable 2FA',
      })
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to enable 2FA',
    })
  }
})
