import { sshKeyManager } from '~~/server/utils/ssh-key-manager'
import { requirePermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  // Get authenticated user
  const { userId } = await requirePermission(event, 'server.view', 'self')

  const keyId = getRouterParam(event, 'keyId')
  if (!keyId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SSH key ID is required',
    })
  }

  try {
    // Verify the key exists and belongs to the user
    const sshKey = await sshKeyManager.getSSHKey(keyId, userId)
    if (!sshKey) {
      throw createError({
        statusCode: 404,
        statusMessage: 'SSH key not found',
      })
    }

    await sshKeyManager.deleteSSHKey(keyId, { userId })

    return {
      success: true,
      message: 'SSH key deleted successfully',
    }
  } catch (error) {
    console.error('Failed to delete SSH key:', error)
    
    if (error instanceof Error && error.message === 'SSH key not found') {
      throw createError({
        statusCode: 404,
        statusMessage: 'SSH key not found',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to delete SSH key',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
