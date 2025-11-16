import { getServerSession } from '#auth'
import { getSessionUser } from '~~/server/utils/session'
import { getServerStatus } from '~~/server/utils/server-status'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const user = getSessionUser(session)

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const serverIdentifier = getRouterParam(event, 'server')
  if (!serverIdentifier) {
    throw createError({ statusCode: 400, statusMessage: 'Server identifier required' })
  }

  try {
    const status = await getServerStatus(serverIdentifier)
    
    return {
      data: {
        state: status.state,
        isOnline: status.isOnline,
        isSuspended: status.isSuspended,
        utilization: status.utilization,
        lastChecked: status.lastChecked.toISOString(),
        error: status.error,
      },
    }
  } catch (error) {
    console.error('Failed to get server status:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to get server status',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
