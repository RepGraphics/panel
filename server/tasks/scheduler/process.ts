// import { parseExpression } from 'cron-parser'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { getWingsClientForServer } from '~~/server/utils/wings-client'
import { serverManager } from '~~/server/utils/server-manager'
import { backupManager } from '~~/server/utils/backup-manager'
import { recordAuditEvent } from '~~/server/utils/audit'

// Simple cron parser fallback until cron-parser is available
function parseNextRun(cronExpression: string): Date {
  const now = new Date()
  const [minute, _hour, _day, _month, _weekday] = cronExpression.split(' ')
  
  const nextRun = new Date(now)
  
  // Simple minute-based scheduling for now
  if (minute === '*') {
    nextRun.setMinutes(now.getMinutes() + 1)
  } else {
    nextRun.setMinutes(parseInt(minute) || 0)
    if (nextRun <= now) {
      nextRun.setHours(nextRun.getHours() + 1)
    }
  }
  
  nextRun.setSeconds(0)
  nextRun.setMilliseconds(0)
  
  return nextRun
}

export default defineTask({
  meta: {
    name: 'scheduler:process',
    description: 'Process scheduled server tasks',
  },
  async run({ payload: _payload, context: _context }) {
    const db = useDrizzle()
    const now = new Date()
    const processedSchedules: string[] = []
    const errors: string[] = []

    try {
      console.log(`[${now.toISOString()}] Processing scheduled tasks...`)

      // Get all enabled schedules that are due
      const schedules = await db
        .select()
        .from(tables.serverSchedules)
        .where(eq(tables.serverSchedules.enabled, true))
        .all()

      for (const schedule of schedules) {
        try {
          // Parse cron expression and check if it's due
          const nextRun = parseNextRun(schedule.cron)
          const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null
          
          // Check if schedule is due (within the last minute)
          const timeSinceLastRun = lastRun ? now.getTime() - lastRun.getTime() : Infinity
          const isOverdue = !lastRun || timeSinceLastRun > 65000 // 65 seconds buffer
          
          if (isOverdue && nextRun <= now) {
            await processSchedule(schedule.id, db)
            processedSchedules.push(schedule.id)
          }
        } catch (scheduleError) {
          const errorMsg = `Schedule ${schedule.id} failed: ${scheduleError instanceof Error ? scheduleError.message : 'Unknown error'}`
          console.error(errorMsg)
          errors.push(errorMsg)
        }
      }

      const result = {
        processedAt: now.toISOString(),
        schedulesProcessed: processedSchedules.length,
        totalSchedules: schedules.length,
        errors: errors.length,
        processedScheduleIds: processedSchedules,
      }

      console.log(`[${now.toISOString()}] Task processing complete:`, result)
      return { result }

    } catch (error) {
      const errorMsg = `Scheduler task failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(errorMsg)
      throw new Error(errorMsg)
    }
  },
})

async function processSchedule(scheduleId: string, db: ReturnType<typeof useDrizzle>) {
  const runningTasks = new Map<string, boolean>()
  
  if (runningTasks.has(scheduleId)) {
    console.log(`Schedule ${scheduleId} is already running, skipping...`)
    return
  }

  runningTasks.set(scheduleId, true)
  const executedAt = new Date()

  try {
    const schedule = await db
      .select()
      .from(tables.serverSchedules)
      .where(eq(tables.serverSchedules.id, scheduleId))
      .get()

    if (!schedule || !schedule.enabled) {
      return
    }

    // Get tasks for this schedule
    const tasks = await db
      .select()
      .from(tables.serverScheduleTasks)
      .where(eq(tables.serverScheduleTasks.scheduleId, scheduleId))
      .orderBy(tables.serverScheduleTasks.sequenceId)
      .all()

    if (tasks.length === 0) {
      console.log(`No tasks found for schedule ${scheduleId}`)
      return
    }

    const server = await db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.id, schedule.serverId))
      .get()

    if (!server) {
      throw new Error('Server not found')
    }

    console.log(`Executing ${tasks.length} tasks for schedule "${schedule.name}" on server ${server.uuid}`)

    let _allTasksSucceeded = true

    // Execute tasks in sequence with time offsets
    for (const task of tasks) {
      // Wait for time offset
      if (task.timeOffset > 0) {
        console.log(`Waiting ${task.timeOffset}s before executing task ${task.id}`)
        await new Promise(resolve => setTimeout(resolve, task.timeOffset * 1000))
      }

      try {
        await executeTask(task, server, schedule)
        console.log(`Task ${task.id} (${task.action}) completed successfully`)
      } catch (taskError) {
        const errorMsg = `Task ${task.id} failed: ${taskError instanceof Error ? taskError.message : 'Unknown error'}`
        console.error(errorMsg)
        _allTasksSucceeded = false

        if (!task.continueOnFailure) {
          console.log(`Task ${task.id} failed and continueOnFailure is false, stopping execution`)
          break
        }
      }
    }

    // Update schedule run times
    const nextRun = parseNextRun(schedule.cron)
    
    await db
      .update(tables.serverSchedules)
      .set({
        lastRunAt: executedAt,
        nextRunAt: nextRun,
        updatedAt: new Date(),
      })
      .where(eq(tables.serverSchedules.id, scheduleId))
      .run()

    console.log(`Schedule ${scheduleId} completed. Next run: ${nextRun.toISOString()}`)

  } finally {
    runningTasks.delete(scheduleId)
  }
}

async function executeTask(
  task: typeof tables.serverScheduleTasks.$inferSelect,
  server: typeof tables.servers.$inferSelect,
  schedule: typeof tables.serverSchedules.$inferSelect
) {
  switch (task.action) {
    case 'command': {
      const { client } = await getWingsClientForServer(server.uuid)
      await client.sendCommand(server.uuid, task.payload || '')
      console.log(`Command executed on ${server.uuid}: ${task.payload}`)
      break
    }

    case 'power': {
      const powerAction = task.payload as 'start' | 'stop' | 'restart' | 'kill'
      await serverManager.powerAction(server.uuid, powerAction, { skipAudit: true })
      console.log(`Power action executed on ${server.uuid}: ${powerAction}`)
      break
    }

    case 'backup': {
      const backupName = task.payload || `scheduled-backup-${Date.now()}`
      await backupManager.createBackup(server.uuid, { 
        name: backupName,
        skipAudit: true 
      })
      console.log(`Backup created for ${server.uuid}: ${backupName}`)
      break
    }

    default:
      throw new Error(`Unknown task action: ${task.action}`)
  }

  // Record audit event for task execution
  await recordAuditEvent({
    actor: 'system',
    actorType: 'system',
    action: `schedule.task.${task.action}`,
    targetType: 'server',
    targetId: server.id,
    metadata: {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      taskId: task.id,
      taskAction: task.action,
      taskPayload: task.payload,
    },
  })
}
