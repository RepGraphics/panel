import { createError } from 'h3'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import { requireAdmin, readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '~~/server/utils/security'
import { suspensionActionSchema } from '#shared/schema/admin/actions'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  const userId = getRouterParam(event, 'id')
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'User ID is required' })
  }

  const body = await readValidatedBodyWithLimit(
    event,
    suspensionActionSchema,
    BODY_SIZE_LIMITS.SMALL,
  )

  const db = useDrizzle()
  const now = new Date()

  try {
    if (body.action === 'ban') {
      const reason = (body.reason ?? '').trim()
      const banExpires = body.banExpiresIn
        ? new Date(Date.now() + body.banExpiresIn * 1000)
        : null
      
      await db.update(tables.users)
        .set({
          banned: true,
          banReason: reason.length > 0 ? reason : null,
          banExpires: banExpires,
          updatedAt: now,
        })
        .where(eq(tables.users.id, userId))
        .run()

      await db.delete(tables.sessions)
        .where(eq(tables.sessions.userId, userId))
        .run()

      await recordAuditEventFromRequest(event, {
        actor: session.user.email || session.user.id,
        actorType: 'user',
        action: 'admin.user.banned',
        targetType: 'user',
        targetId: userId,
        metadata: {
          reason: reason.length > 0 ? reason : undefined,
          banExpiresIn: body.banExpiresIn || undefined,
        },
      })

      return {
        success: true,
        banned: true,
        reason: reason.length > 0 ? reason : null,
      }
    }

    if (body.action === 'unban') {
      await db.update(tables.users)
        .set({
          banned: false,
          banReason: null,
          banExpires: null,
          updatedAt: now,
        })
        .where(eq(tables.users.id, userId))
        .run()

      await recordAuditEventFromRequest(event, {
        actor: session.user.email || session.user.id,
        actorType: 'user',
        action: 'admin.user.unbanned',
        targetType: 'user',
        targetId: userId,
      })

      return {
        success: true,
        banned: false,
      }
    }

    const existing = db
      .select({
        id: tables.users.id,
        username: tables.users.username,
        suspended: tables.users.suspended,
      })
      .from(tables.users)
      .where(eq(tables.users.id, userId))
      .get()

    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'User not found' })
    }

    if (body.action === 'suspend') {
      const reason = (body.reason ?? '').trim()

      await db.update(tables.users)
        .set({
          suspended: true,
          suspendedAt: now,
          suspensionReason: reason.length > 0 ? reason : null,
          updatedAt: now,
        })
        .where(eq(tables.users.id, userId))
        .run()

      await db.delete(tables.sessions)
        .where(eq(tables.sessions.userId, userId))
        .run()

      await recordAuditEventFromRequest(event, {
        actor: session.user.email || session.user.id,
        actorType: 'user',
        action: 'admin.user.suspend',
        targetType: 'user',
        targetId: userId,
        metadata: {
          reason: reason.length > 0 ? reason : undefined,
        },
      })

      return {
        success: true,
        suspended: true,
        reason: reason.length > 0 ? reason : null,
      }
    }

    await db.update(tables.users)
      .set({
        suspended: false,
        suspendedAt: null,
        suspensionReason: null,
        updatedAt: now,
      })
      .where(eq(tables.users.id, userId))
      .run()

    await recordAuditEventFromRequest(event, {
      actor: session.user.email || session.user.id,
      actorType: 'user',
      action: 'admin.user.unsuspend',
      targetType: 'user',
      targetId: userId,
    })

    return {
      success: true,
      suspended: false,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to perform action'
    throw createError({
      statusCode: 500,
      statusMessage: message,
    })
  }
})
