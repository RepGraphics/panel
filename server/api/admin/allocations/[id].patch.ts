import { createError } from 'h3'
import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { requireAdminApiKeyPermission } from '~~/server/utils/admin-api-permissions'
import { ADMIN_ACL_RESOURCES, ADMIN_ACL_PERMISSIONS } from '~~/server/utils/admin-acl'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  
  await requireAdminApiKeyPermission(event, ADMIN_ACL_RESOURCES.ALLOCATIONS, ADMIN_ACL_PERMISSIONS.WRITE)

  const allocationId = getRouterParam(event, 'id')
  if (!allocationId) {
    throw createError({
      statusCode: 400,
      message: 'Allocation ID is required',
    })
  }

  const body = await readBody(event)
  const { ipAlias } = body

  const db = useDrizzle()
  const [allocation] = db.select()
    .from(tables.serverAllocations)
    .where(eq(tables.serverAllocations.id, allocationId))
    .limit(1)
    .all()

  if (!allocation) {
    throw createError({
      statusCode: 404,
      message: 'Allocation not found',
    })
  }

  db.update(tables.serverAllocations)
    .set({
      ipAlias: ipAlias || null,
      updatedAt: new Date(),
    })
    .where(eq(tables.serverAllocations.id, allocationId))
    .run()

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.allocation.updated',
    targetType: 'settings',
    targetId: allocationId,
    metadata: {
      ip: allocation.ip,
      port: allocation.port,
      ipAlias: ipAlias || null,
    },
  })

  return {
    success: true,
    message: 'Allocation updated successfully',
  }
})
