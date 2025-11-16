import { sshKeyManager } from '~~/server/utils/ssh-key-manager'
import { requirePermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  // Get authenticated user
  const { userId } = await requirePermission(event, 'server.view', 'self')

  const body = await readBody<{ name: string; publicKey: string }>(event)
  const { name, publicKey } = body

  if (!name || !publicKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name and public key are required',
    })
  }

  // Validate the SSH key format first
  const validation = sshKeyManager.validatePublicKey(publicKey)
  if (!validation.isValid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid SSH key',
      data: { error: validation.error },
    })
  }

  try {
    const sshKey = await sshKeyManager.createSSHKey({
      userId,
      name: name.trim(),
      publicKey: publicKey.trim(),
    })

    return {
      success: true,
      data: {
        id: sshKey.id,
        name: sshKey.name,
        fingerprint: sshKey.fingerprint,
        keyType: validation.keyType,
        createdAt: sshKey.createdAt.toISOString(),
      },
    }
  } catch (error) {
    console.error('Failed to create SSH key:', error)
    
    if (error instanceof Error && error.message === 'SSH key already exists') {
      throw createError({
        statusCode: 409,
        statusMessage: 'SSH key already exists',
        data: { fingerprint: validation.fingerprint },
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create SSH key',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
