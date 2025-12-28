import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const keyId = getRouterParam(event, 'id')

  if (!keyId) {
    throw createError({
      statusCode: 400,
      message: 'API key ID is required',
    })
  }

  const db = useDrizzle()

  const key = db
    .select()
    .from(tables.apiKeys)
    .where(eq(tables.apiKeys.id, keyId))
    .get()

  if (!key) {
    throw createError({
      statusCode: 404,
      message: 'API key not found',
    })
  }

  db.delete(tables.apiKeys)
    .where(eq(tables.apiKeys.id, keyId))
    .run()

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.api_key.deleted',
    targetType: 'api_key',
    targetId: keyId,
    metadata: {
      keyName: key.name,
      keyUserId: key.userId,
    },
  })

  return { success: true }
})
