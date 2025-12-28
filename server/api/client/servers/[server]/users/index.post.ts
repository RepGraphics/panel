import { randomUUID } from 'crypto'
import { getServerSession } from '~~/server/utils/session'
import { getServerWithAccess } from '~~/server/utils/server-helpers'
import { useDrizzle, tables, eq, and } from '~~/server/utils/drizzle'
import { readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '~~/server/utils/security'
import { createSubuserSchema } from '#shared/schema/server/subusers'
import { invalidateServerSubusersCache } from '~~/server/utils/subusers'
import { requireServerPermission } from '~~/server/utils/permission-middleware'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const serverId = getRouterParam(event, 'server')

  if (!serverId) {
    throw createError({
      statusCode: 400,
      message: 'Server identifier is required',
    })
  }

  const { server } = await getServerWithAccess(serverId, session)

  // Verify user has permission to manage server users
  await requireServerPermission(event, {
    serverId: server.id,
    requiredPermissions: ['server.users.create'],
  })

  const body = await readValidatedBodyWithLimit(
    event,
    createSubuserSchema,
    BODY_SIZE_LIMITS.SMALL,
  )

  const db = useDrizzle()
  const targetUser = db
    .select()
    .from(tables.users)
    .where(eq(tables.users.email, body.email))
    .get()

  if (!targetUser) {
    throw createError({
      statusCode: 404,
      message: 'User not found with that email address',
    })
  }

  const existing = db
    .select()
    .from(tables.serverSubusers)
    .where(
      and(
        eq(tables.serverSubusers.serverId, server.id),
        eq(tables.serverSubusers.userId, targetUser.id)
      )
    )
    .get()

  if (existing) {
    throw createError({
      statusCode: 400,
      message: 'User is already a subuser on this server',
    })
  }

  const subuserId = randomUUID()
  const now = new Date()

  db.insert(tables.serverSubusers)
    .values({
      id: subuserId,
      serverId: server.id,
      userId: targetUser.id,
      permissions: JSON.stringify(body.permissions),
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const subuser = db
    .select()
    .from(tables.serverSubusers)
    .where(eq(tables.serverSubusers.id, subuserId))
    .get()

  await invalidateServerSubusersCache(server.id, [targetUser.id])

  await recordAuditEventFromRequest(event, {
    actor: session?.user?.id || 'unknown',
    actorType: 'user',
    action: 'server.user.add',
    targetType: 'server',
    targetId: server.id,
    metadata: {
      subuserId,
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email,
      permissions: body.permissions,
    },
  })

  return {
    data: {
      id: subuser!.id,
      user: {
        id: targetUser.id,
        username: targetUser.username,
        email: targetUser.email,
        image: targetUser.image,
      },
      permissions: JSON.parse(subuser!.permissions),
      created_at: subuser!.createdAt,
      updated_at: subuser!.updatedAt,
    },
  }
})
