import { useDrizzle, tables, eq, and } from '~~/server/utils/drizzle'
import { requirePermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  const serverId = getRouterParam(event, 'server')
  const scheduleId = getRouterParam(event, 'schedule')

  if (!serverId || !scheduleId) {
    throw createError({
      statusCode: 400,
      message: 'Server and schedule identifiers are required',
    })
  }

  // Check permissions - user must have schedule update access
  await requirePermission(event, 'server.schedule.update', serverId)

  const db = useDrizzle()
  const schedule = db
    .select()
    .from(tables.serverSchedules)
    .where(
      and(
        eq(tables.serverSchedules.id, scheduleId),
        eq(tables.serverSchedules.serverId, serverId)
      )
    )
    .get()

  if (!schedule) {
    throw createError({
      statusCode: 404,
      message: 'Schedule not found',
    })
  }

  try {
    const { executeScheduledTask } = await import('../../../../../../utils/task-scheduler')

    const tasks = await db
      .select()
      .from(tables.serverScheduleTasks)
      .where(eq(tables.serverScheduleTasks.scheduleId, scheduleId))
      .all()

    for (const task of tasks.sort((a, b) => a.sequenceId - b.sequenceId)) {

      if (task.timeOffset > 0) {
        await new Promise(resolve => setTimeout(resolve, task.timeOffset * 1000))
      }

      await executeScheduledTask(scheduleId, task.id)
    }
  } catch (error) {
    console.error('Failed to execute schedule:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to execute schedule tasks',
    })
  }

  db.update(tables.serverSchedules)
    .set({
      lastRunAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tables.serverSchedules.id, scheduleId))
    .run()

  return {
    success: true,
    message: 'Schedule execution triggered',
  }
})
