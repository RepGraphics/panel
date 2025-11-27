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
  const query = getQuery(event)
  const file = query.file as string

  if (!uuid) {
    throw createError({
      statusCode: 400,
      message: 'Server UUID is required',
    })
  }

  if (!file) {
    throw createError({
      statusCode: 400,
      message: 'File path is required',
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
    requiredPermissions: ['file.read'],
  })

  const { getWingsClientForServer } = await import('~~/server/utils/wings-client')
  const { client } = await getWingsClientForServer(uuid)

  try {
    const content = await client.getFileContents(uuid, file)

    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return content
  } catch (error) {
    console.error('Failed to read file:', error)
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to read file',
    })
  }
})
