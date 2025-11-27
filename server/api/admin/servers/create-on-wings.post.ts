import { createError } from 'h3'
import { getServerSession } from '~~/server/utils/session'
import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { provisionServerOnWings } from '~~/server/utils/server-provisioning'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.user) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized',
    })
  }

  await requireAdmin(event)

  const body = await readBody(event)
  const { serverId } = body

  if (!serverId) {
    throw createError({
      statusCode: 400,
      message: 'Server ID is required',
    })
  }

  const db = useDrizzle()

  const server = db
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

  if (!server.nodeId || !server.eggId) {
    throw createError({
      statusCode: 400,
      message: 'Server is missing required configuration (node or egg)',
    })
  }

  const allocations = db
    .select()
    .from(tables.serverAllocations)
    .where(eq(tables.serverAllocations.serverId, server.id))
    .all()

  const primaryAllocation = allocations.find(a => a.isPrimary)
  if (!primaryAllocation) {
    throw createError({
      statusCode: 400,
      message: 'Server has no primary allocation assigned',
    })
  }

  const { startOnCompletion = true } = body

  try {
    await provisionServerOnWings({
      serverId: server.id,
      serverUuid: server.uuid,
      eggId: server.eggId,
      nodeId: server.nodeId,
      allocationId: primaryAllocation.id,
      environment: {},
      startOnCompletion,
    })

    return {
      success: true,
      message: 'Server provisioned on Wings successfully',
    }
  } catch (error) {
    console.error('Failed to provision server on Wings:', error)
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to provision server on Wings',
    })
  }
})
