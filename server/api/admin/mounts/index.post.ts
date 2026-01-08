import { requireAdmin } from '~~/server/utils/security'
import { useDrizzle, tables } from '~~/server/utils/drizzle'
import { requireAdminApiKeyPermission } from '~~/server/utils/admin-api-permissions'
import { ADMIN_ACL_RESOURCES, ADMIN_ACL_PERMISSIONS } from '~~/server/utils/admin-acl'
import type { CreateMountPayload } from '#shared/types/admin'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { recordAuditEventFromRequest } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  await requireAdminApiKeyPermission(event, ADMIN_ACL_RESOURCES.MOUNTS, ADMIN_ACL_PERMISSIONS.WRITE)

  const body = await readBody<CreateMountPayload>(event)

  if (!body.name || !body.source || !body.target) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Name, source, and target are required',
    })
  }

  const db = useDrizzle()

  if (body.nodes && body.nodes.length > 0) {
    const nodes = await db.select({ id: tables.wingsNodes.id })
      .from(tables.wingsNodes)
      .where(inArray(tables.wingsNodes.id, body.nodes))
      .all()

    if (nodes.length !== body.nodes.length) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'One or more nodes were not found' })
    }
  }

  if (body.eggs && body.eggs.length > 0) {
    const eggs = await db.select({ id: tables.eggs.id })
      .from(tables.eggs)
      .where(inArray(tables.eggs.id, body.eggs))
      .all()

    if (eggs.length !== body.eggs.length) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'One or more eggs were not found' })
    }
  }

  const mountId = randomUUID()
  const now = new Date()

  const newMount = {
    id: mountId,
    uuid: randomUUID(),
    name: body.name,
    description: body.description ?? null,
    source: body.source,
    target: body.target,
    readOnly: body.readOnly ?? false,
    userMountable: body.userMountable ?? false,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(tables.mounts).values(newMount)

  if (body.nodes && body.nodes.length > 0) {
    await db.insert(tables.mountNode).values(
      body.nodes.map((nodeId) => ({
        mountId,
        nodeId,
      })),
    )
  }

  if (body.eggs && body.eggs.length > 0) {
    await db.insert(tables.mountEgg).values(
      body.eggs.map((eggId) => ({
        mountId,
        eggId,
      })),
    )
  }

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.mount.created',
    targetType: 'settings',
    targetId: mountId,
    metadata: {
      mountName: newMount.name,
      source: newMount.source,
      target: newMount.target,
      nodeCount: body.nodes?.length || 0,
      eggCount: body.eggs?.length || 0,
    },
  })

  return {
    data: {
      id: newMount.id,
      uuid: newMount.uuid,
      name: newMount.name,
      description: newMount.description,
      source: newMount.source,
      target: newMount.target,
      readOnly: newMount.readOnly,
      userMountable: newMount.userMountable,
      createdAt: newMount.createdAt.toISOString(),
      updatedAt: newMount.updatedAt.toISOString(),
    },
  }
})
