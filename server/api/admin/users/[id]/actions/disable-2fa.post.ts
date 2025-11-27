import { createError } from 'h3'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import { requireAdmin } from '~~/server/utils/security'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  const userId = getRouterParam(event, 'id')
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'User ID is required' })
  }

  const db = useDrizzle()

  const existing = db
    .select({
      id: tables.users.id,
      username: tables.users.username,
      twoFactorEnabled: tables.users.twoFactorEnabled,
    })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .get()

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'User not found' })
  }

  try {
    await db.update(tables.users)
      .set({
        twoFactorEnabled: false,
        useTotp: false,
        totpSecret: null,
        totpAuthenticatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(tables.users.id, userId))
      .run()

    await db.delete(tables.twoFactor)
      .where(eq(tables.twoFactor.userId, userId))
      .run()

    await recordAuditEventFromRequest(event, {
      actor: session.user.email || session.user.id,
      actorType: 'user',
      action: 'admin.user.disable_2fa',
      targetType: 'user',
      targetId: userId,
    })

    return {
      success: true,
      message: existing.twoFactorEnabled
        ? 'Two-factor authentication has been disabled for the user.'
        : 'Two-factor authentication was already disabled.',
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to disable 2FA'
    throw createError({
      statusCode: 500,
      statusMessage: message,
    })
  }
})
