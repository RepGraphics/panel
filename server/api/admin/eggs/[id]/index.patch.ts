import { eq } from 'drizzle-orm'
import { getServerSession, isAdmin } from '~~/server/utils/session'
import { useDrizzle, tables } from '~~/server/utils/drizzle'
import { updateEggSchema } from '#shared/schema/admin/infrastructure'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)

  if (!isAdmin(session)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const eggId = getRouterParam(event, 'id')
  if (!eggId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Egg ID is required' })
  }

  const body = await readValidatedBody(event, payload => updateEggSchema.parse(payload))

  if (Object.keys(body).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'No fields provided to update' })
  }

  const db = useDrizzle()

  const egg = await db
    .select()
    .from(tables.eggs)
    .where(eq(tables.eggs.id, eggId))
    .get()

  if (!egg) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Egg not found' })
  }

  const now = new Date()
  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.nestId) updates.nestId = body.nestId
  if (body.name !== undefined) updates.name = body.name
  if (body.description !== undefined) updates.description = body.description ?? null
  if (body.dockerImage !== undefined) updates.dockerImage = body.dockerImage
  if (body.dockerImages !== undefined) {
    updates.dockerImages = body.dockerImages ? JSON.stringify(body.dockerImages) : null
  }
  if (body.startup !== undefined) updates.startup = body.startup
  if (body.configFiles !== undefined) updates.configFiles = body.configFiles ? JSON.stringify(body.configFiles) : null
  if (body.configStartup !== undefined) updates.configStartup = body.configStartup ? JSON.stringify(body.configStartup) : null
  if (body.configStop !== undefined) updates.configStop = body.configStop ?? null
  if (body.configLogs !== undefined) updates.configLogs = body.configLogs ? JSON.stringify(body.configLogs) : null
  if (body.scriptContainer !== undefined) updates.scriptContainer = body.scriptContainer ?? null
  if (body.scriptEntry !== undefined) updates.scriptEntry = body.scriptEntry ?? null
  if (body.scriptInstall !== undefined) updates.scriptInstall = body.scriptInstall ?? null
  if (body.copyScriptFrom !== undefined) updates.copyScriptFrom = body.copyScriptFrom ?? null

  db.update(tables.eggs)
    .set(updates)
    .where(eq(tables.eggs.id, eggId))
    .run()

  const updatedEgg = await db
    .select()
    .from(tables.eggs)
    .where(eq(tables.eggs.id, eggId))
    .get()

  if (!updatedEgg) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Egg not found after update' })
  }

  return {
    data: {
      id: updatedEgg.id,
      uuid: updatedEgg.uuid,
      nestId: updatedEgg.nestId,
      author: updatedEgg.author,
      name: updatedEgg.name,
      description: updatedEgg.description,
      dockerImage: updatedEgg.dockerImage,
      dockerImages: updatedEgg.dockerImages ? JSON.parse(updatedEgg.dockerImages) : null,
      startup: updatedEgg.startup,
      configStop: updatedEgg.configStop,
      updatedAt: new Date(updatedEgg.updatedAt).toISOString(),
    },
  }
})
