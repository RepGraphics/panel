import { getServerSession } from '#auth'
import { getSessionUser } from '~~/server/utils/session'
import { getWingsClientForServer, WingsConnectionError, WingsAuthError } from '~~/server/utils/wings-client'

function sanitizePath(path: string): string {
  // Remove any path traversal attempts
  const sanitized = path.replace(/\.\./g, '').replace(/\/+/g, '/')
  // Ensure it starts with /
  return sanitized.startsWith('/') ? sanitized : `/${sanitized}`
}

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  const user = getSessionUser(session)
  
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const serverId = getRouterParam(event, 'server')
  const query = getQuery(event)
  const directory = sanitizePath((query.directory as string) || '/')

  if (!serverId) {
    throw createError({
      statusCode: 400,
      message: 'Server identifier is required',
    })
  }

  try {
    const { client, server } = await getWingsClientForServer(serverId)
    const files = await client.listFiles(server.uuid as string, directory)

    // Sort files: directories first, then files, both alphabetically
    const sortedFiles = files.sort((a, b) => {
      if (a.is_file !== b.is_file) {
        return a.is_file ? 1 : -1 // Directories first
      }
      return a.name.localeCompare(b.name)
    })

    return {
      data: {
        files: sortedFiles,
        directory,
        parent: directory === '/' ? null : directory.split('/').slice(0, -1).join('/') || '/',
      },
    }
  } catch (error) {
    console.error('Failed to list files from Wings:', error)
    
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
      statusMessage: 'Failed to list files',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
})
