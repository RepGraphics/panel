import { getServerSession } from '#auth'
import { isAdmin } from '~~/server/utils/session'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { getWingsClient, WingsConnectionError, WingsAuthError } from '~~/server/utils/wings-client'
import type { WingsNode } from '~~/server/utils/wings-client'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)

  if (!isAdmin(session)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const nodeId = getRouterParam(event, 'id')
  if (!nodeId) {
    throw createError({ statusCode: 400, statusMessage: 'Node ID is required' })
  }

  const db = useDrizzle()

  const node = await db
    .select()
    .from(tables.wingsNodes)
    .where(eq(tables.wingsNodes.id, nodeId))
    .get()

  if (!node) {
    throw createError({ statusCode: 404, statusMessage: 'Node not found' })
  }

  const wingsNode: WingsNode = {
    id: node.id,
    fqdn: node.fqdn,
    scheme: node.scheme as 'http' | 'https',
    daemonListen: node.daemonListen,
    daemonSftp: node.daemonSftp,
    daemonBase: node.daemonBase,
    tokenId: node.tokenIdentifier,
    token: node.tokenSecret,
  }

  const client = getWingsClient(wingsNode)

  try {
    const isConnected = await client.testConnection()
    
    if (isConnected) {
      const systemInfo = await client.getSystemInfo()
      
      // Update last seen timestamp
      await db
        .update(tables.wingsNodes)
        .set({
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tables.wingsNodes.id, nodeId))
        .run()

      return {
        success: true,
        connected: true,
        message: 'Successfully connected to Wings daemon',
        systemInfo,
      }
    } else {
      return {
        success: false,
        connected: false,
        message: 'Failed to connect to Wings daemon',
      }
    }
  } catch (error) {
    console.error('Wings connection test failed:', error)

    let errorMessage = 'Unknown connection error'
    let errorType = 'unknown'

    if (error instanceof WingsAuthError) {
      errorMessage = 'Authentication failed - check node tokens'
      errorType = 'auth'
    } else if (error instanceof WingsConnectionError) {
      errorMessage = error.message
      errorType = 'connection'
    } else if (error instanceof Error) {
      errorMessage = error.message
    }

    return {
      success: false,
      connected: false,
      message: errorMessage,
      errorType,
    }
  }
})
