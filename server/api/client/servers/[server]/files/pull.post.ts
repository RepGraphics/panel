import { getServerSession } from '~~/server/utils/session'
import { getServerWithAccess } from '~~/server/utils/server-helpers'
import { getWingsClientForServer } from '~~/server/utils/wings-client'
import { requireServerPermission } from '~~/server/utils/permission-middleware'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const serverId = getRouterParam(event, 'server')

  if (!serverId) {
    throw createError({
      statusCode: 400,
      message: 'Server identifier is required',
    })
  }

  const { server } = await getServerWithAccess(serverId, session)

  await requireServerPermission(event, {
    serverId: server.id,
    requiredPermissions: ['server.files.write'],
  })

  const body = await readBody(event)
  const { url, directory, filename, use_header } = body

  if (!url) {
    throw createError({
      statusCode: 400,
      message: 'URL is required',
    })
  }

  try {
    const { client } = await getWingsClientForServer(server.uuid)
    await client.pullFile(server.uuid, url, directory || '/', filename, use_header, true)

    await recordAuditEventFromRequest(event, {
      actor: session?.user?.id || 'unknown',
      actorType: 'user',
      action: 'server.file.pull',
      targetType: 'server',
      targetId: server.id,
      metadata: { url, directory: directory || '/', filename },
    })

    return {
      success: true,
      message: 'File pull initiated',
    }
  } catch (error) {
    console.error('Failed to pull file on Wings:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to pull file from URL',
    })
  }
})
