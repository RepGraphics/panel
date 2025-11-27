import { createError } from 'h3'
import { readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '~~/server/utils/security'
import { initiateServerTransfer } from '~~/server/utils/transfers/initiate'
import { requireAdminPermission } from '~~/server/utils/permission-middleware'
import { serverTransferSchema } from '~~/shared/schema/admin/server'

export default defineEventHandler(async (event) => {
  const serverId = getRouterParam(event, 'server')
  if (!serverId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Server identifier is required',
    })
  }

  await requireAdminPermission(event)

  const body = await readValidatedBodyWithLimit(
    event,
    serverTransferSchema,
    BODY_SIZE_LIMITS.MEDIUM,
  )
  const { nodeId: targetNodeId, allocationId, additionalAllocationIds, startOnCompletion } = body

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
