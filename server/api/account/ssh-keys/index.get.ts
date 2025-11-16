import { sshKeyManager } from '~~/server/utils/ssh-key-manager'
import { requirePermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  // Get authenticated user
  const { userId } = await requirePermission(event, 'server.view', 'self')

  try {
    const sshKeys = await sshKeyManager.listSSHKeys(userId)

    return {
      success: true,
      data: sshKeys.map(key => ({
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        // Don't return the full public key in list view for security
        publicKey: `${key.publicKey.split(' ')[0]} ${key.publicKey.split(' ')[1].substring(0, 20)}...`,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
      })),
    }
  } catch (error) {
    console.error('Failed to list SSH keys:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to list SSH keys',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
