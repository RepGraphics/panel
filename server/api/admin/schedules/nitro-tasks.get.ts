import { requireAdmin } from '~~/server/utils/security'
import type { NitroTasksResponse } from '#shared/types/admin'

export default defineEventHandler(async (event): Promise<NitroTasksResponse> => {
  await requireAdmin(event)

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
