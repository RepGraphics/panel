import { createError, readBody, type H3Event } from 'h3'
import { getAuth, normalizeHeadersForAuth } from '~~/server/utils/auth'
import { createWingsNode, toWingsNodeSummary } from '~~/server/utils/wings/nodesStore'
import { recordAuditEvent } from '~~/server/utils/audit'

import type { ActorType, TargetType } from '#shared/types/audit'
import type { CreateWingsNodeInput } from '#shared/types/wings'

export default defineEventHandler(async (event: H3Event) => {
  const auth = getAuth()
  
  const session = await auth.api.getSession({
    headers: normalizeHeadersForAuth(event.node.req.headers),
  })

  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const userRole = (session.user as { role?: string }).role
  if (userRole !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Admin access required',
    })
  }

  const user = session.user

  const body = await readBody<CreateWingsNodeInput>(event)
  if (!body?.name || !body?.baseURL) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: name, baseURL' })
  }

  try {
    const node = createWingsNode(body)

    await recordAuditEvent({
      actor: (user as { username?: string; email?: string }).username ?? (user as { email?: string }).email ?? 'system',
      actorType: (userRole ?? 'system') as ActorType,
      action: 'admin:node.create',
      targetType: 'node' satisfies TargetType,
      targetId: node.id,
      metadata: {
        name: node.name,
        fqdn: node.fqdn,
        baseUrl: node.baseURL,
      },
    })

    return { data: toWingsNodeSummary(node) }
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to create node'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
