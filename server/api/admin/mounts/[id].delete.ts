import { eq } from 'drizzle-orm'
import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  const mountId = getRouterParam(event, 'id')
  if (!mountId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Mount ID is required' })
  }

  const db = useDrizzle()

  const existing = await db
    .select()
    .from(tables.mounts)
    .where(eq(tables.mounts.id, mountId))
    .get()

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Mount not found' })
  }

  await db.delete(tables.mounts).where(eq(tables.mounts.id, mountId))

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.mount.deleted',
    targetType: 'settings',
    targetId: mountId,
    metadata: {
      mountName: existing.name,
      source: existing.source,
      target: existing.target,
    },
  })

  return { success: true }
})
