import { getNodeForServer } from '~~/server/utils/server-helpers'
import { generateWebSocketCredentials } from '~~/server/utils/wings/jwt'
import { requirePermission } from '~~/server/utils/permission-middleware'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'

export default defineEventHandler(async (event) => {
  const serverId = getRouterParam(event, 'server')

  if (!serverId) {
    throw createError({
      statusCode: 400,
      message: 'Server identifier is required',
    })
  }

  // Check permissions - user must have console access
  const { userId } = await requirePermission(event, 'server.console', serverId)

  // Get server details
  const db = useDrizzle()
  const server = await db
    .select()
    .from(tables.servers)
    .where(eq(tables.servers.id, serverId))
    .get()

  if (!server) {
    throw createError({
      statusCode: 404,
      message: 'Server not found',
    })
  }

  const node = await getNodeForServer(server.nodeId)

  try {
    const credentials = await generateWebSocketCredentials(
      {
        id: node.id,
        baseUrl: node.baseUrl,
        tokenSecret: node.tokenSecret,
        scheme: node.scheme,
        fqdn: node.fqdn,
        daemonListen: node.daemonListen,
      },
      {
        uuid: server.uuid,
        id: server.id,
      },
      {
        id: userId,
        uuid: userId,
      }
    )

    return {
      data: credentials,
    }
  } catch (error) {
    console.error('Failed to generate WebSocket credentials:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to generate WebSocket credentials',
    })
  }
})
