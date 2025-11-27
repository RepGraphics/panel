export default defineEventHandler(async (event) => {
  const { getServerSession } = await import('~~/server/utils/session')
  const session = await getServerSession(event)
  if (!session?.user) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized',
    })
  }

  const uuid = getRouterParam(event, 'uuid')

  if (!uuid) {
    throw createError({
      statusCode: 400,
      message: 'Server UUID is required',
    })
  }

  const body = await readBody(event)
  const { root, files } = body

  if (!root || !files || !Array.isArray(files)) {
    throw createError({
      statusCode: 400,
      message: 'Root directory and files array are required',
    })
  }

  const { useDrizzle, tables, eq } = await import('~~/server/utils/drizzle')
  const db = useDrizzle()

  const server = db
    .select()
    .from(tables.servers)
    .where(eq(tables.servers.uuid, uuid))
    .get()

  if (!server) {
    throw createError({
      statusCode: 404,
      message: 'Server not found',
    })
  }

  const { requireServerPermission } = await import('~~/server/utils/permission-middleware')
  await requireServerPermission(event, {
    serverId: server.id,
    requiredPermissions: ['file.delete'],
  })

  const { getWingsClientForServer } = await import('~~/server/utils/wings-client')
  const { client } = await getWingsClientForServer(uuid)

  try {
    await client.deleteFiles(uuid, root, files)

    return {
      success: true,
      message: `Deleted ${files.length} file(s)`,
    }
  } catch (error) {
    console.error('Failed to delete files:', error)
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to delete files',
    })
  }
})
