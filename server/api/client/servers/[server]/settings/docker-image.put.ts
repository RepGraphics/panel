import { getServerSession } from '~~/server/utils/session'
import { getServerWithAccess } from '~~/server/utils/server-helpers'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
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
    requiredPermissions: ['server.settings.update'],
  })

  const body = await readBody(event)
  const { docker_image } = body

  if (!docker_image) {
    throw createError({
      statusCode: 400,
      message: 'Docker image is required',
    })
  }

  const db = useDrizzle()
  const [egg] = db.select()
    .from(tables.eggs)
    .where(eq(tables.eggs.id, server.eggId!))
    .limit(1)
    .all()

  if (!egg) {
    throw createError({
      statusCode: 404,
      message: 'Egg not found',
    })
  }

  let eggDockerImages: Record<string, string> = {}
  if (egg.dockerImages) {
    try {
      eggDockerImages = typeof egg.dockerImages === 'string' 
        ? JSON.parse(egg.dockerImages) 
        : egg.dockerImages
    } catch (e) {
      console.warn('[Docker Image PUT] Failed to parse egg dockerImages:', e)
    }
  }
  
  if (Object.keys(eggDockerImages).length === 0 && egg.dockerImage) {
    eggDockerImages = { [egg.name || 'Default']: egg.dockerImage }
  }

  const currentImage = server.dockerImage || server.image
  const isInEggImages = Object.values(eggDockerImages).includes(currentImage || '')
  
  if (!isInEggImages && currentImage) {
    throw createError({
      statusCode: 400,
      message: 'This server\'s Docker image has been manually set by an administrator and cannot be updated.',
    })
  }

  const oldImage = server.dockerImage || server.image

  db.update(tables.servers)
    .set({
      dockerImage: docker_image,
      image: docker_image, 
      updatedAt: new Date(),
    })
    .where(eq(tables.servers.id, server.id))
    .run()

  await recordAuditEventFromRequest(event, {
    actor: session?.user?.id || 'unknown',
    actorType: 'user',
    action: 'server.settings.docker_image.update',
    targetType: 'server',
    targetId: server.id,
    metadata: { oldImage, newImage: docker_image },
  })

  return {
    object: 'server',
    attributes: {
      docker_image,
    },
  }
})
