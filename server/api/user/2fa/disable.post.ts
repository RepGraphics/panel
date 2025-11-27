import { createError } from 'h3'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import bcrypt from 'bcryptjs'

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
      statusMessage: 'Password is required to disable 2FA',
    })
  }

  const db = useDrizzle()
  const userId = session.user.id

  const user = db
    .select({
      password: tables.users.password,
      useTotp: tables.users.useTotp,
    })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .get()

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    })
  }

  const isValidPassword = await bcrypt.compare(password, user.password)
  if (!isValidPassword) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid password',
    })
  }

  if (!user.useTotp) {
    throw createError({
      statusCode: 400,
      statusMessage: '2FA is not enabled for this account',
    })
  }

  try {
    db.update(tables.users)
      .set({
        useTotp: false,
        totpSecret: null,
        totpAuthenticatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(tables.users.id, userId))
      .run()

    db.delete(tables.twoFactor)
      .where(eq(tables.twoFactor.userId, userId))
      .run()

    await recordAuditEventFromRequest(event, {
      actor: session.user.email || session.user.id,
      actorType: 'user',
      action: 'auth.2fa.disabled',
      targetType: 'user',
      targetId: userId,
    })

    return {
      success: true,
      message: '2FA disabled successfully',
    }
  }
  catch (error) {
    console.error('Failed to disable 2FA:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to disable 2FA',
    })
  }
})
