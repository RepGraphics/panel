import { assertMethod, createError, getValidatedRouterParams } from 'h3'
import { getServerSession } from '~~/server/utils/session'
import { useDrizzle, tables, eq, and } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  assertMethod(event, 'DELETE')

  const session = await getServerSession(event)

  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { identifier } = await getValidatedRouterParams(event, (params) => {
    const identifierParam = (params as Record<string, unknown>).identifier
    if (typeof identifierParam !== 'string' || identifierParam.trim().length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Missing API key identifier' })
    }

    return { identifier: identifierParam }
  })

  const db = useDrizzle()

  const apiKey = db
    .select({
      id: tables.apiKeys.id,
      userId: tables.apiKeys.userId,
    })
    .from(tables.apiKeys)
    .where(
      and(
        eq(tables.apiKeys.identifier, identifier),
        eq(tables.apiKeys.userId, session.user.id)
      )
    )
    .get()

  if (!apiKey) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'API key not found',
    })
  }

  await db.delete(tables.apiKeys)
    .where(eq(tables.apiKeys.id, apiKey.id))
    .run()

  await recordAuditEventFromRequest(event, {
    actor: session.user.id,
    actorType: 'user',
    action: 'account.api_key.delete',
    targetType: 'user',
    targetId: identifier,
    metadata: {
      identifier,
    },
  })

  return { success: true }
})
