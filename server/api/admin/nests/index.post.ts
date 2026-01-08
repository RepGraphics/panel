import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables } from '~~/server/utils/drizzle'
import { requireAdminApiKeyPermission } from '~~/server/utils/admin-api-permissions'
import { ADMIN_ACL_RESOURCES, ADMIN_ACL_PERMISSIONS } from '~~/server/utils/admin-acl'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import type { CreateNestPayload } from '#shared/types/admin'
import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  await requireAdminApiKeyPermission(event, ADMIN_ACL_RESOURCES.NESTS, ADMIN_ACL_PERMISSIONS.WRITE)

  const body = await readBody<CreateNestPayload>(event)

  if (!body.name || !body.author) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Name and author are required' })
  }

  const db = useDrizzle()
  const now = new Date()

  const newNest = {
    id: randomUUID(),
    uuid: randomUUID(),
    author: body.author,
    name: body.name,
    description: body.description || null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(tables.nests).values(newNest)

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.nest.created',
    targetType: 'settings',
    targetId: newNest.id,
    metadata: {
      name: body.name,
      author: body.author,
      description: body.description || null,
    },
  })

  return {
    data: {
      id: newNest.id,
      uuid: newNest.uuid,
      author: newNest.author,
      name: newNest.name,
      description: newNest.description,
      createdAt: newNest.createdAt.toISOString(),
      updatedAt: newNest.updatedAt.toISOString(),
    },
  }
})
