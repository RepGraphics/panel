import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getServerSession } from '~~/server/utils/session'
import { readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '~~/server/utils/security'
import { createApiKeySchema } from '#shared/schema/account'
import type { ApiKeyResponse } from '#shared/types/api'
import { useDrizzle, tables } from '~~/server/utils/drizzle'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'
import { generateIdentifier, generateApiToken, hashApiToken, formatApiKey } from '~~/server/utils/apiKeys'

export default defineEventHandler(async (event): Promise<ApiKeyResponse> => {
  const session = await getServerSession(event)

  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'You must be logged in to create API keys',
    })
  }

  const body = await readValidatedBodyWithLimit(
    event,
    createApiKeySchema,
    BODY_SIZE_LIMITS.SMALL,
  )

  try {
    const db = useDrizzle()
    const now = new Date()
    const identifier = generateIdentifier()
    const token = generateApiToken()
    const hashedToken = await hashApiToken(token)
    const apiKeyId = randomUUID()

    await db.insert(tables.apiKeys)
      .values({
        id: apiKeyId,
        userId: session.user.id,
        keyType: 1,
        identifier,
        token: hashedToken,
        key: formatApiKey(identifier, token),
        allowedIps: body.allowedIps ? JSON.stringify(body.allowedIps) : null,
        memo: body.memo || null,
        lastUsedAt: null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const secretToken = formatApiKey(identifier, token)

    await recordAuditEventFromRequest(event, {
      actor: session.user.id,
      actorType: 'user',
      action: 'account.api_key.create',
      targetType: 'user',
      targetId: identifier,
      metadata: {
        identifier,
        hasDescription: !!body.memo,
        allowedIpsCount: body.allowedIps?.length || 0,
      },
    })

    return {
      data: {
        identifier,
        description: body.memo || null,
        allowed_ips: body.allowedIps || [],
        last_used_at: null,
        created_at: now.toISOString(),
      },
      meta: {
        secret_token: secretToken,
      },
    }
  } catch (error) {
    console.error('Error creating API key:', error)
    
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Failed to create API key',
    })
  }
})
