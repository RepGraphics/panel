import { initiateServerTransfer } from '~~/server/utils/transfers/initiate'
import { requireAdminPermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  const serverId = getRouterParam(event, 'server')
  if (!serverId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Server identifier is required',
    })
  }

  // Check permissions - admin only
  await requireAdminPermission(event)

  const body = await readBody<{
    targetNodeId: string
    allocationId?: string
    additionalAllocationIds?: string[]
    startOnCompletion?: boolean
  }>(event)

  const { targetNodeId, allocationId, additionalAllocationIds, startOnCompletion } = body

  if (!targetNodeId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Target node ID is required',
    })
  }

  try {
    const result = await initiateServerTransfer(serverId, targetNodeId, {
      allocationId,
      additionalAllocationIds,
      startOnCompletion,
    })

    return {
      success: true,
      data: {
        transferId: result.transferId,
        server: result.server,
        sourceNodeId: result.sourceNodeId,
        targetNodeId: result.targetNodeId,
        newAllocationId: result.newAllocationId,
      },
    }
  } catch (error) {
    console.error('Failed to initiate server transfer:', error)
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to initiate server transfer',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
