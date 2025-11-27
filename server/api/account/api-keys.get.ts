import { createError } from 'h3'
import { getServerSession, getSessionUser } from '~~/server/utils/session'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)

  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const user = getSessionUser(session)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const db = useDrizzle()

  const keys = db
    .select({
      id: tables.apiKeys.id,
      identifier: tables.apiKeys.identifier,
      memo: tables.apiKeys.memo,
      allowedIps: tables.apiKeys.allowedIps,
      lastUsedAt: tables.apiKeys.lastUsedAt,
      expiresAt: tables.apiKeys.expiresAt,
      createdAt: tables.apiKeys.createdAt,
      metadata: tables.apiKeys.metadata,
    })
    .from(tables.apiKeys)
    .where(eq(tables.apiKeys.userId, user.id))
    .orderBy(tables.apiKeys.createdAt)
    .all()

  return {
    data: keys.map(key => {
      let metadata: { memo?: string; allowedIps?: string[] } | null = null
      if (key.metadata) {
        try {
          metadata = typeof key.metadata === 'string' ? JSON.parse(key.metadata) : key.metadata
        } catch {
          metadata = null
        }
      }

      let allowedIps: string[] = []
      if (key.allowedIps) {
        if (typeof key.allowedIps === 'string') {
          try {
            const parsed = JSON.parse(key.allowedIps)
            allowedIps = Array.isArray(parsed) ? parsed : []
          } catch {
            allowedIps = key.allowedIps.split(',').map(ip => ip.trim()).filter(Boolean)
          }
        } else if (Array.isArray(key.allowedIps)) {
          allowedIps = key.allowedIps
        }
      }

      if (metadata?.allowedIps && Array.isArray(metadata.allowedIps)) {
        allowedIps = metadata.allowedIps
      }

      return {
        identifier: key.identifier || key.id,
        description: key.memo || metadata?.memo || null,
        allowed_ips: allowedIps,
        last_used_at: key.lastUsedAt?.toISOString() || null,
        created_at: key.createdAt.toISOString(),
      }
    }),
  }
})
