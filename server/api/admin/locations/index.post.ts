import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables } from '~~/server/utils/drizzle'
import { requireAdminApiKeyPermission } from '~~/server/utils/admin-api-permissions'
import { ADMIN_ACL_RESOURCES, ADMIN_ACL_PERMISSIONS } from '~~/server/utils/admin-acl'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import type { CreateLocationPayload } from '#shared/types/admin'
import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  await requireAdminApiKeyPermission(event, ADMIN_ACL_RESOURCES.LOCATIONS, ADMIN_ACL_PERMISSIONS.WRITE)

  const body = await readBody<CreateLocationPayload>(event)

  if (!body.short) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Short code is required' })
  }

  const db = useDrizzle()
  const now = new Date()

  const newLocation = {
    id: randomUUID(),
    short: body.short,
    long: body.long || null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(tables.locations).values(newLocation)

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.location.created',
    targetType: 'settings',
    targetId: newLocation.id,
    metadata: {
      short: body.short,
      long: body.long || null,
    },
  })

  return {
    data: {
      id: newLocation.id,
      short: newLocation.short,
      long: newLocation.long,
      createdAt: newLocation.createdAt.toISOString(),
      updatedAt: newLocation.updatedAt.toISOString(),
    },
  }
})
