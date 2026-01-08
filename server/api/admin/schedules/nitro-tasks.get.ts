import { requireAdmin } from '~~/server/utils/security'
import { requireAdminApiKeyPermission } from '~~/server/utils/admin-api-permissions'
import { ADMIN_ACL_RESOURCES, ADMIN_ACL_PERMISSIONS } from '~~/server/utils/admin-acl'
import type { NitroTasksResponse } from '#shared/types/admin'

export default defineEventHandler(async (event): Promise<NitroTasksResponse> => {
  await requireAdmin(event)

  await requireAdminApiKeyPermission(event, ADMIN_ACL_RESOURCES.SCHEDULES, ADMIN_ACL_PERMISSIONS.READ)

  try {
    const url = new URL('/_nitro/tasks', `http://${event.node.req.headers.host}`)
    const response = await fetch(url.toString())
    const data = await response.json() as NitroTasksResponse
    return data
  } catch (error) {
    console.error('Failed to fetch Nitro tasks:', error)
    return {
      tasks: {},
      scheduledTasks: [],
    }
  }
})
