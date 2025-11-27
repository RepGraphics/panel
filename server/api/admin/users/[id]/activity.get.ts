import { createError, getQuery } from 'h3'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { useDrizzle, tables, eq, or } from '~~/server/utils/drizzle'
import { desc, count } from 'drizzle-orm'
import { getNumericSetting, SETTINGS_KEYS } from '~~/server/utils/settings'

export default defineEventHandler(async (event) => {
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

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'User ID is required',
    })
  }

  const query = getQuery(event)
  const page = Math.max(1, Number.parseInt(query.page as string ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(10, Number.parseInt(query.limit as string ?? String(getNumericSetting(SETTINGS_KEYS.PAGINATION_LIMIT, 25)), 10) || 25))
  const offset = (page - 1) * limit

  const db = useDrizzle()

  const user = db
    .select({
      id: tables.users.id,
      email: tables.users.email,
      username: tables.users.username,
    })
    .from(tables.users)
    .where(eq(tables.users.id, id))
    .get()

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    })
  }

  const activityConditions = [eq(tables.auditEvents.actor, user.id)]
  if (user.email) {
    activityConditions.push(eq(tables.auditEvents.actor, user.email))
  }
  if (user.username) {
    activityConditions.push(eq(tables.auditEvents.actor, user.username))
  }

  const totalResult = db
    .select({ count: count() })
    .from(tables.auditEvents)
    .where(or(...activityConditions))
    .get()
  const totalCount = totalResult?.count ?? 0

  const activityEvents = db
    .select({
      id: tables.auditEvents.id,
      occurredAt: tables.auditEvents.occurredAt,
      action: tables.auditEvents.action,
      actor: tables.auditEvents.actor,
      targetType: tables.auditEvents.targetType,
      targetId: tables.auditEvents.targetId,
      metadata: tables.auditEvents.metadata,
    })
    .from(tables.auditEvents)
    .where(or(...activityConditions))
    .orderBy(desc(tables.auditEvents.occurredAt))
    .limit(limit)
    .offset(offset)
    .all()

  const formatTimestamp = (value: number | Date | null | undefined) => {
    if (!value) {
      return null
    }

    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  const parseMetadata = (value: string | null) => {
    if (!value) {
      return {}
    }

    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
      return { value: parsed }
    }
    catch {
      return { raw: value }
    }
  }

  const totalPages = Math.ceil(totalCount / limit)

  return {
    data: activityEvents.map(entry => ({
      id: entry.id,
      occurredAt: formatTimestamp(entry.occurredAt)!,
      action: entry.action,
      target: entry.targetId ? `${entry.targetType}#${entry.targetId}` : entry.targetType,
      actor: entry.actor,
      details: parseMetadata(entry.metadata ?? null),
    })),
    pagination: {
      page,
      perPage: limit,
      total: totalCount,
      totalPages,
    },
  }
})

