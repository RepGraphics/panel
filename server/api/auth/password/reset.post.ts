import { createError } from 'h3'
import { APIError } from 'better-auth/api'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'

interface ResetBody {
  token?: string
  newPassword?: string
  password?: string
}

const MIN_PASSWORD_LENGTH = 12

export default defineEventHandler(async (event) => {
  const body = await readBody<ResetBody>(event)
  const token = body.token?.trim() ?? ''
  const password = body.newPassword?.trim() ?? body.password?.trim() ?? ''

  if (token.length === 0 || password.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Token and password are required',
    })
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    })
  }

  const auth = getAuth()
  
  try {
    await auth.api.resetPassword({
      body: {
        token,
        newPassword: password,
      },
      headers: normalizeHeadersForAuth(event.node.req.headers),
    })

    return { success: true }
  }
  catch (error) {
    if (error instanceof APIError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message || 'Invalid or expired password reset token',
      })
    }
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid or expired password reset token',
    })
  }
})
