import { createError, getQuery } from 'h3'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
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
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(eq(tables.users.id, id))
    .get()

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    })
  }

  const totalResult = db
    .select({ count: count() })
    .from(tables.servers)
    .where(eq(tables.servers.ownerId, user.id))
    .get()
  const totalCount = totalResult?.count ?? 0

  const servers = db
    .select({
      id: tables.servers.id,
      uuid: tables.servers.uuid,
      identifier: tables.servers.identifier,
      name: tables.servers.name,
      status: tables.servers.status,
      suspended: tables.servers.suspended,
      createdAt: tables.servers.createdAt,
      nodeName: tables.wingsNodes.name,
    })
    .from(tables.servers)
    .leftJoin(tables.wingsNodes, eq(tables.servers.nodeId, tables.wingsNodes.id))
    .where(eq(tables.servers.ownerId, user.id))
    .orderBy(desc(tables.servers.createdAt))
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

  const totalPages = Math.ceil(totalCount / limit)

  return {
    data: servers.map(server => ({
      id: server.id,
      uuid: server.uuid,
      identifier: server.identifier,
      name: server.name,
      status: server.status,
      suspended: Boolean(server.suspended),
      nodeName: server.nodeName ?? null,
      createdAt: formatTimestamp(server.createdAt)!,
    })),
    pagination: {
      page,
      perPage: limit,
      total: totalCount,
      totalPages,
    },
  }
})

