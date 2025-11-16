import { backupManager } from '~~/server/utils/backup-manager'
import { WingsConnectionError, WingsAuthError } from '~~/server/utils/wings-client'
import { requirePermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  const serverId = getRouterParam(event, 'server')
  if (!serverId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Server identifier is required',
    })
  }

  // Check permissions - user must have backup create access
  const { userId } = await requirePermission(event, 'server.backup.create', serverId)

  const body = await readBody<{ name?: string; ignored?: string }>(event)
  const { name, ignored } = body

  try {
    const backup = await backupManager.createBackup(serverId, {
      name,
      ignoredFiles: ignored,
      userId,
    })

    return {
      success: true,
      data: {
        id: backup.id,
        uuid: backup.uuid,
        name: backup.name,
        size: backup.size,
        isSuccessful: backup.isSuccessful,
        isLocked: backup.isLocked,
        checksum: backup.checksum,
        ignoredFiles: backup.ignoredFiles,
        completedAt: backup.completedAt?.toISOString(),
        createdAt: backup.createdAt.toISOString(),
      },
    }
  } catch (error) {
    console.error('Failed to create backup:', error)
    
    if (error instanceof WingsAuthError) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Wings authentication failed',
      })
    }
    
    if (error instanceof WingsConnectionError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Wings daemon unavailable',
      })
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create backup',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
