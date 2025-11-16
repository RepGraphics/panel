import { getServerSession } from '#auth'
import { isAdmin, getSessionUser } from '~~/server/utils/session'
import { serverManager } from '~~/server/utils/server-manager'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { WingsConnectionError, WingsAuthError } from '~~/server/utils/wings-client'
import type { ServerActionPayload, ServerActionResponse } from '#shared/types/admin-servers'

export default defineEventHandler(async (event): Promise<ServerActionResponse> => {
  const session = await getServerSession(event)
  const user = getSessionUser(session)

  if (!isAdmin(session)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const serverId = getRouterParam(event, 'id')
  if (!serverId) {
    throw createError({ statusCode: 400, statusMessage: 'Server ID is required' })
  }

  const body = await readBody<ServerActionPayload>(event)

  if (!body.action) {
    throw createError({ statusCode: 400, statusMessage: 'Action is required' })
  }

  const db = useDrizzle()
  const server = await db
    .select()
    .from(tables.servers)
    .where(eq(tables.servers.id, serverId))
    .get()

  if (!server) {
    throw createError({ statusCode: 404, statusMessage: 'Server not found' })
  }

  try {
    const options = { userId: user?.id }

    switch (body.action) {
      case 'suspend':
        await serverManager.suspendServer(server.uuid, options)
        break
      case 'unsuspend':
        await serverManager.unsuspendServer(server.uuid, options)
        break
      case 'reinstall':
        await serverManager.reinstallServer(server.uuid, options)
        break
      case 'delete':
        await serverManager.deleteServer(server.uuid, options)
        break
      case 'start':
      case 'stop':
      case 'restart':
      case 'kill':
        await serverManager.powerAction(server.uuid, body.action, options)
        break
      default:
        throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
    }

    return {
      success: true,
      message: `Server ${body.action} action completed successfully`,
    }
  } catch (error) {
    console.error(`Server ${body.action} action failed:`, error)

    if (error instanceof WingsAuthError) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Wings authentication failed',
        data: { error: error.message },
      })
    }

    if (error instanceof WingsConnectionError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Wings daemon unavailable',
        data: { error: error.message },
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: `Failed to ${body.action} server`,
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
