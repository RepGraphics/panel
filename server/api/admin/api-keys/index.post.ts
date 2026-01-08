import { randomUUID } from 'node:crypto'
import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { requireAdminApiKeyPermission } from '~~/server/utils/admin-api-permissions'
import { ADMIN_ACL_RESOURCES, ADMIN_ACL_PERMISSIONS } from '~~/server/utils/admin-acl'
import { generateIdentifier, generateApiToken, formatApiKey } from '~~/server/utils/apiKeys'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import type { CreateApiKeyPayload, CreateApiKeyResponse } from '#shared/types/admin'

export default defineEventHandler(async (event): Promise<CreateApiKeyResponse> => {
  const session = await requireAdmin(event)

  await requireAdminApiKeyPermission(event, ADMIN_ACL_RESOURCES.API_KEYS, ADMIN_ACL_PERMISSIONS.WRITE)

  const user = session.user

  if (!user || !user.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'User not found in session',
    })
  }

  const db = useDrizzle()

  const dbUser = db.select().from(tables.users).where(eq(tables.users.id, user.id)).get()
  if (!dbUser) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found in database. Please log out and log back in.',
    })
  }

  const body = await readBody<CreateApiKeyPayload>(event)

  const identifier = generateIdentifier()
  const token = generateApiToken()

  const now = new Date()

  const apiKeyId = randomUUID()

  db.insert(tables.apiKeys).values({
    id: apiKeyId,
    userId: user.id,
    name: body.memo || 'API Key',
    start: formatApiKey(identifier, token).slice(0, 6),
    prefix: 'sk',
    key: formatApiKey(identifier, token),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    enabled: true,
    rateLimitEnabled: true,
    requestCount: 0,
    createdAt: now,
    updatedAt: now,
  }).run()

  db.insert(tables.apiKeyMetadata).values({
    id: randomUUID(),
    apiKeyId: apiKeyId,
    keyType: 1,
    allowedIps: body.allowedIps ? JSON.stringify(body.allowedIps) : null,
    memo: body.memo || null,
    createdAt: now,
    updatedAt: now,
  }).run()

  if (body.permissions && Object.values(body.permissions).some(actions => actions && actions.length > 0)) {
    db.update(tables.apiKeys)
      .set({
        metadata: JSON.stringify(body.permissions),
      })
      .where(eq(tables.apiKeys.id, apiKeyId))
      .run()
  }

  await recordAuditEventFromRequest(event, {
    actor: user.id,
    actorType: 'user',
    action: 'admin.api_key.create',
    targetType: 'api_key',
    targetId: apiKeyId,
    metadata: {
      identifier,
      memo: body.memo || null,
      allowedIpsCount: body.allowedIps?.length || 0,
      permissions: body.permissions,
    },
  })

  return {
    id: apiKeyId,
    identifier,
    apiKey: formatApiKey(identifier, token),
    memo: body.memo || null,
    createdAt: now.toISOString(),
  }
})
