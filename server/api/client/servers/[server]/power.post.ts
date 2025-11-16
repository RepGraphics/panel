import { serverManager } from '~~/server/utils/server-manager'
import { WingsConnectionError, WingsAuthError } from '~~/server/utils/wings-client'
import { requireServerPermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  const serverIdentifier = getRouterParam(event, 'server')

  if (!serverIdentifier) {
    throw createError({ statusCode: 400, statusMessage: 'Server identifier required' })
  }

  // Check permissions - user must have power control access
  const { userId } = await requireServerPermission(event, {
    serverId: serverIdentifier,
    requiredPermissions: ['server.power'],
  })

  const body = await readBody<{ action: 'start' | 'stop' | 'restart' | 'kill' }>(event)

  if (!body.action) {
    throw createError({ statusCode: 400, statusMessage: 'Action is required' })
  }

  const validActions = ['start', 'stop', 'restart', 'kill']
  if (!validActions.includes(body.action)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }

  try {
    await serverManager.powerAction(serverIdentifier, body.action, {
      userId,
    })

    return {
      success: true,
      message: `Power action ${body.action} sent successfully`,
    }
  } catch (error) {
    console.error('Wings power action failed:', error)
    
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
      statusMessage: 'Failed to send power action to Wings',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
