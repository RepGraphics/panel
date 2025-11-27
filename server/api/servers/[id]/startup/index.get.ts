import { createError } from 'h3'
import { resolveServerRequest } from '~~/server/utils/http/serverAccess'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { getServerSession } from '~~/server/utils/session'
import { resolveSessionUser } from '~~/server/utils/auth/sessionUser'

export default defineEventHandler(async (event) => {
  const identifier = event.context.params?.id
  
  const contextAuth = (event.context as { auth?: { session?: Awaited<ReturnType<typeof getServerSession>> } }).auth
  console.log('[Startup GET] Handler started:', {
    identifier,
    path: event.path,
    hasAuth: !!contextAuth,
    hasSession: !!contextAuth?.session,
    hasUser: !!contextAuth?.user,
    timestamp: new Date().toISOString(),
  })
  
  if (!identifier) {
    throw createError({
      statusCode: 400,
      message: 'Server identifier is required',
    })
  }

  const session = await getServerSession(event)
  const user = resolveSessionUser(session)

  console.log('[Startup GET] Session check:', {
    hasSession: !!session,
    hasUser: !!user,
    userId: user?.id,
    timestamp: new Date().toISOString(),
  })

  if (!user) {
    console.error('[Startup GET] No user found - returning 401')
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'No authenticated user found for startup endpoint',
    })
  }

  console.log('[Startup GET] Request received with valid user:', {
    identifier,
    userId: user.id,
    username: user.username,
    path: event.path,
    timestamp: new Date().toISOString(),
  })

  try {
    const context = await resolveServerRequest(event, {
      identifier,
      requiredPermissions: ['startup.read'],
      fallbackPermissions: [], 
    })

    console.log('[Startup GET] Server request resolved:', {
      serverId: context.server.id,
      serverUuid: context.server.uuid,
      userId: context.user.id,
      isOwner: context.isOwner,
      isAdmin: context.isAdmin,
      hasStartupRead: context.permissions.includes('startup.read'),
      timestamp: new Date().toISOString(),
    })

    const db = useDrizzle()
    
    const egg = context.server.eggId
      ? db
          .select()
          .from(tables.eggs)
          .where(eq(tables.eggs.id, context.server.eggId))
          .get()
      : null

    let dockerImages: Record<string, string> = {}
    if (egg?.dockerImages) {
      try {
        dockerImages = typeof egg.dockerImages === 'string' 
          ? JSON.parse(egg.dockerImages) 
          : egg.dockerImages
      } catch (e) {
        console.warn('[Startup GET] Failed to parse egg dockerImages:', e)
      }
    }
    
    if (Object.keys(dockerImages).length === 0 && egg?.dockerImage) {
      dockerImages = { [egg.name || 'Default']: egg.dockerImage }
    }

    const envVars = db.select()
      .from(tables.serverStartupEnv)
      .where(eq(tables.serverStartupEnv.serverId, context.server.id))
      .all()

    const serverEnvMap = new Map<string, string>()
    for (const envVar of envVars) {
      serverEnvMap.set(envVar.key, envVar.value || '')
    }

    const environment: Record<string, string> = {}
    
    if (egg?.id) {
      const eggVariables = db
        .select()
        .from(tables.eggVariables)
        .where(eq(tables.eggVariables.eggId, egg.id))
        .all()

      for (const eggVar of eggVariables) {
        const value = serverEnvMap.get(eggVar.envVariable) ?? eggVar.defaultValue ?? ''
        environment[eggVar.envVariable] = value
      }
    }

    for (const [key, value] of serverEnvMap.entries()) {
      if (!environment[key]) {
        environment[key] = value
      }
    }

    const response = {
      data: {
        startup: context.server.startup || egg?.startup || '',
        dockerImage: context.server.dockerImage || context.server.image || egg?.dockerImage || '',
        dockerImages,
        environment,
      },
    }

    console.log('[Startup GET] Response prepared:', {
      serverId: context.server.id,
      hasStartup: !!response.data.startup,
      dockerImage: response.data.dockerImage,
      dockerImagesCount: Object.keys(response.data.dockerImages).length,
      envVarsCount: Object.keys(response.data.environment).length,
      timestamp: new Date().toISOString(),
    })

    return response
  } catch (error) {
    console.error('[Startup GET] Error:', {
      error: error instanceof Error ? error.message : String(error),
      identifier,
      path: event.path,
      timestamp: new Date().toISOString(),
    })
    throw error
  }
})
