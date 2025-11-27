import { assertMethod, createError, getValidatedRouterParams } from 'h3'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { useDrizzle, tables, eq, and } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  assertMethod(event, 'DELETE')

  const auth = getAuth()
  
  const session = await auth.api.getSession({
    headers: normalizeHeadersForAuth(event.node.req.headers),
  })

  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const userRole = (session.user as { role?: string }).role
  if (userRole !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Admin access required',
    })
  }

  const { id: userId } = await getValidatedRouterParams(event, (params) => {
    const idParam = (params as Record<string, unknown>).id
    if (typeof idParam !== 'string' || idParam.trim().length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Missing user ID' })
    }
    return { id: idParam }
  })

  const { identifier } = await getValidatedRouterParams(event, (params) => {
    const identifierParam = (params as Record<string, unknown>).identifier
    if (typeof identifierParam !== 'string' || identifierParam.trim().length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Missing API key identifier' })
    }
    return { identifier: identifierParam }
  })

  const db = useDrizzle()

  const targetUser = db
    .select({ id: tables.users.id, username: tables.users.username })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .get()

  if (!targetUser) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  const apiKey = db
    .select({
      id: tables.apiKeys.id,
      identifier: tables.apiKeys.identifier,
      memo: tables.apiKeys.memo,
    })
    .from(tables.apiKeys)
    .where(
      and(
        eq(tables.apiKeys.identifier, identifier),
        eq(tables.apiKeys.userId, userId)
      )
    )
    .get()

  if (!apiKey) {
    throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  }

  db.delete(tables.apiKeys)
    .where(eq(tables.apiKeys.id, apiKey.id))
    .run()

  await recordAuditEventFromRequest(event, {
    actor: session.user.id,
    actorType: 'user',
    action: 'admin.user.api_key.delete',
    targetType: 'user',
    targetId: userId,
    metadata: {
      targetUserId: userId,
      targetUsername: targetUser.username,
      apiKeyIdentifier: identifier,
      apiKeyMemo: apiKey.memo,
    },
  })

  return { success: true }
})

