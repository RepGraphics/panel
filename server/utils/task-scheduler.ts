import { useDrizzle, tables, eq } from './drizzle'
import { getWingsClientForServer } from './wings-client'
import { serverManager } from './server-manager'
import { backupManager } from './backup-manager'
import { recordAuditEvent } from './audit'
import { randomUUID } from 'crypto'
import type {
  ScheduleTask,
  ScheduleInfo,
  TaskExecutionResult,
  ScheduleExecutionResult,
  TaskAction,
  PowerAction,
} from '#shared/types/task-scheduler'

export class TaskScheduler {
  private db = useDrizzle()
  private runningTasks = new Map<string, boolean>()
  private isProcessingQueue = false

  // Parse cron expression to get next run time
  private parseNextRun(cronExpression: string, lastRun?: Date): Date {
    // Simplified cron parser - in production, use a proper cron library like node-cron
    const now = lastRun ? new Date(lastRun.getTime() + 60000) : new Date()
    const tokens = cronExpression.split(' ')
    const minuteToken = tokens.at(0)

    const parsedMinute = minuteToken ? Number.parseInt(minuteToken, 10) : NaN
    const minute = Number.isNaN(parsedMinute) ? 0 : parsedMinute

    const nextRun = new Date(now)
    nextRun.setMinutes(minute)
    nextRun.setSeconds(0)
    nextRun.setMilliseconds(0)
    
    // If the time has passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1)
    }
    
    return nextRun
  }

  private isCronDue(cronExpression: string, now: Date): boolean {
    const [minute, hour, day, month, weekday] = cronExpression.split(' ')
    
    const nowMinute = now.getMinutes()
    const nowHour = now.getHours()
    const nowDay = now.getDate()
    const nowMonth = now.getMonth() + 1
    const nowDayOfWeek = now.getDay()

    const equals = (token: string | undefined, value: number) => {
      if (!token || token === '*') {
        return true
      }

      const parsed = Number.parseInt(token, 10)
      if (Number.isNaN(parsed)) {
        return false
      }

      return parsed === value
    }

    if (!equals(minute, nowMinute)) return false
    if (!equals(hour, nowHour)) return false
    if (!equals(day, nowDay)) return false
    if (!equals(month, nowMonth)) return false
    if (!equals(weekday, nowDayOfWeek)) return false

    return true
  }

  async executeScheduledTask(
    scheduleId: string,
    taskId: string
  ): Promise<TaskExecutionResult> {
    const executedAt = new Date()
    
    try {
      const task = await this.db
        .select()
        .from(tables.serverScheduleTasks)
        .where(eq(tables.serverScheduleTasks.id, taskId))
        .get()

      if (!task) {
        throw new Error('Task not found')
      }

      const schedule = await this.db
        .select()
        .from(tables.serverSchedules)
        .where(eq(tables.serverSchedules.id, scheduleId))
        .get()

      if (!schedule) {
        throw new Error('Schedule not found')
      }

      const server = await this.db
        .select()
        .from(tables.servers)
        .where(eq(tables.servers.id, schedule.serverId))
        .get()

      if (!server) {
        throw new Error('Server not found')
      }

      const serverUuid = server.uuid
      if (!serverUuid) {
        throw new Error('Server missing UUID')
      }

      let output: string | undefined

      // Execute task based on action type
      switch (task.action) {
        case 'command': {
          const { client } = await getWingsClientForServer(serverUuid)
          await client.sendCommand(serverUuid, task.payload ?? '')
          output = `Command executed: ${task.payload}`
          break
        }

        case 'power': {
          const powerAction = (task.payload ?? '') as PowerAction
          await serverManager.powerAction(serverUuid, powerAction, { skipAudit: true })
          output = `Power action executed: ${powerAction}`
          break
        }

        case 'backup': {
          const backupName = task.payload || `scheduled-backup-${Date.now()}`
          await backupManager.createBackup(serverUuid, { 
            name: backupName,
            skipAudit: true 
          })
          output = `Backup created: ${backupName}`
          break
        }

        default:
          throw new Error(`Unknown task action: ${task.action}`)
      }

      return {
        taskId,
        success: true,
        output,
        executedAt,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      return {
        taskId,
        success: false,
        error: errorMessage,
        executedAt,
      }
    }
  }

  async executeSchedule(scheduleId: string): Promise<ScheduleExecutionResult> {
    if (this.runningTasks.has(scheduleId)) {
      throw new Error('Schedule is already running')
    }

    this.runningTasks.set(scheduleId, true)
    const executedAt = new Date()
    const taskResults: TaskExecutionResult[] = []
    let scheduleSuccess = true

    try {
      const schedule = await this.db
        .select()
        .from(tables.serverSchedules)
        .where(eq(tables.serverSchedules.id, scheduleId))
        .get()

      if (!schedule) {
        throw new Error('Schedule not found')
      }

      if (!schedule.enabled) {
        throw new Error('Schedule is disabled')
      }

      // Get tasks for this schedule
      const tasks = await this.db
        .select()
        .from(tables.serverScheduleTasks)
        .where(eq(tables.serverScheduleTasks.scheduleId, scheduleId))
        .orderBy(tables.serverScheduleTasks.sequenceId)
        .all()

      // Execute tasks in sequence with time offsets
      for (const task of tasks) {
        // Wait for time offset
        if (task.timeOffset > 0) {
          await new Promise(resolve => setTimeout(resolve, task.timeOffset * 1000))
        }

        const result = await this.executeScheduledTask(scheduleId, task.id)
        taskResults.push(result)

        if (!result.success) {
          scheduleSuccess = false
          if (!task.continueOnFailure) {
            break // Stop executing remaining tasks
          }
        }
      }

      // Update schedule run times
      const nextRun = this.parseNextRun(schedule.cron, executedAt)
      await this.db
        .update(tables.serverSchedules)
        .set({
          lastRunAt: executedAt,
          nextRunAt: nextRun,
          updatedAt: new Date(),
        })
        .where(eq(tables.serverSchedules.id, scheduleId))
        .run()

      return {
        scheduleId,
        success: scheduleSuccess,
        tasks: taskResults,
        executedAt,
      }
    } finally {
      this.runningTasks.delete(scheduleId)
    }
  }

  async processScheduledTasks(): Promise<void> {
    if (this.isProcessingQueue) {
      return // Already processing
    }

    this.isProcessingQueue = true
    const now = new Date()

    try {
      // Get all enabled schedules
      const schedules = await this.db
        .select()
        .from(tables.serverSchedules)
        .where(eq(tables.serverSchedules.enabled, true))
        .all()

      for (const schedule of schedules) {
        // Check if schedule is due using cron expression
        if (this.isCronDue(schedule.cron, now)) {
          try {
            await this.executeSchedule(schedule.id)
          } catch (error) {
            console.error(`Schedule ${schedule.id} failed:`, error)
          }
        }
      }
    } finally {
      this.isProcessingQueue = false
    }
  }

  async createSchedule(
    serverId: string,
    name: string,
    cron: string,
    tasks: Omit<ScheduleTask, 'id'>[],
    userId?: string
  ): Promise<ScheduleInfo> {
    const scheduleId = randomUUID()
    const now = new Date()
    const nextRun = this.parseNextRun(cron)

    // Create schedule
    await this.db.insert(tables.serverSchedules).values({
      id: scheduleId,
      serverId,
      name,
      cron,
      action: 'task', // Default action
      nextRunAt: nextRun,
      lastRunAt: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })

    // Create tasks
    const taskRecords = tasks.map((task, index) => ({
      id: randomUUID(),
      scheduleId,
      sequenceId: task.sequenceId || index + 1,
      action: task.action,
      payload: task.payload,
      timeOffset: task.timeOffset || 0,
      continueOnFailure: task.continueOnFailure || false,
      isQueued: false,
      createdAt: now,
      updatedAt: now,
    }))

    for (const taskRecord of taskRecords) {
      await this.db.insert(tables.serverScheduleTasks).values(taskRecord)
    }

    if (userId) {
      await recordAuditEvent({
        actor: userId,
        actorType: 'user',
        action: 'server.schedule.create',
        targetType: 'server',
        targetId: serverId,
        metadata: { scheduleId, name, cron, taskCount: tasks.length },
      })
    }

    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.id, serverId))
      .get()

    return {
      id: scheduleId,
      serverId,
      serverUuid: server?.uuid || '',
      name,
      cron,
      enabled: true,
      nextRunAt: nextRun,
      lastRunAt: undefined,
      tasks: taskRecords.map(t => ({
        id: t.id,
        action: t.action as TaskAction,
        payload: t.payload,
        timeOffset: t.timeOffset,
        sequenceId: t.sequenceId,
        continueOnFailure: t.continueOnFailure,
        isQueued: t.isQueued,
      })),
      createdAt: now,
      updatedAt: now,
    }
  }

  async deleteSchedule(scheduleId: string, userId?: string): Promise<void> {
    const schedule = await this.db
      .select()
      .from(tables.serverSchedules)
      .where(eq(tables.serverSchedules.id, scheduleId))
      .get()

    if (!schedule) {
      throw new Error('Schedule not found')
    }

    // Delete tasks first
    await this.db
      .delete(tables.serverScheduleTasks)
      .where(eq(tables.serverScheduleTasks.scheduleId, scheduleId))
      .run()

    // Delete schedule
    await this.db
      .delete(tables.serverSchedules)
      .where(eq(tables.serverSchedules.id, scheduleId))
      .run()

    if (userId) {
      await recordAuditEvent({
        actor: userId,
        actorType: 'user',
        action: 'server.schedule.delete',
        targetType: 'server',
        targetId: schedule.serverId,
        metadata: { scheduleId, name: schedule.name },
      })
    }
  }

  async getSchedule(scheduleId: string): Promise<ScheduleInfo | null> {
    const schedule = await this.db
      .select()
      .from(tables.serverSchedules)
      .where(eq(tables.serverSchedules.id, scheduleId))
      .get()

    if (!schedule) {
      return null
    }

    const tasks = await this.db
      .select()
      .from(tables.serverScheduleTasks)
      .where(eq(tables.serverScheduleTasks.scheduleId, scheduleId))
      .orderBy(tables.serverScheduleTasks.sequenceId)
      .all()

    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.id, schedule.serverId))
      .get()

    return {
      id: schedule.id,
      serverId: schedule.serverId,
      serverUuid: server?.uuid || '',
      name: schedule.name,
      cron: schedule.cron,
      enabled: schedule.enabled,
      nextRunAt: schedule.nextRunAt || undefined,
      lastRunAt: schedule.lastRunAt || undefined,
      tasks: tasks.map(t => ({
        id: t.id,
        action: t.action as TaskAction,
        payload: t.payload ?? '',
        timeOffset: t.timeOffset,
        sequenceId: t.sequenceId,
        continueOnFailure: t.continueOnFailure,
        isQueued: t.isQueued,
      })),
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    }
  }

  async listSchedules(serverId?: string): Promise<ScheduleInfo[]> {
    const query = this.db.select().from(tables.serverSchedules)
    
    if (serverId) {
      query.where(eq(tables.serverSchedules.serverId, serverId))
    }
    
    const schedules = await query.orderBy(tables.serverSchedules.createdAt).all()
    
    const results: ScheduleInfo[] = []
    for (const schedule of schedules) {
      const scheduleInfo = await this.getSchedule(schedule.id)
      if (scheduleInfo) {
        results.push(scheduleInfo)
      }
    }
    
    return results
  }

  async toggleSchedule(scheduleId: string, enabled: boolean, userId?: string): Promise<void> {
    const schedule = await this.db
      .select()
      .from(tables.serverSchedules)
      .where(eq(tables.serverSchedules.id, scheduleId))
      .get()

    if (!schedule) {
      throw new Error('Schedule not found')
    }

    await this.db
      .update(tables.serverSchedules)
      .set({
        enabled,
        updatedAt: new Date(),
      })
      .where(eq(tables.serverSchedules.id, scheduleId))
      .run()

    if (userId) {
      await recordAuditEvent({
        actor: userId,
        actorType: 'user',
        action: enabled ? 'server.schedule.enable' : 'server.schedule.disable',
        targetType: 'server',
        targetId: schedule.serverId,
        metadata: { scheduleId, name: schedule.name },
      })
    }
  }

  // Start the scheduler (call this on server startup)
  startScheduler(): void {
    console.log('Starting task scheduler...')
    
    // Process schedules every minute
    setInterval(() => {
      this.processScheduledTasks().catch(error => {
        console.error('Scheduled task processing failed:', error)
      })
    }, 60000) // 60 seconds
  }

  // Stop all running tasks (call this on server shutdown)
  stopScheduler(): void {
    console.log('Stopping task scheduler...')
    this.runningTasks.clear()
  }
}

// Export singleton instance
export const taskScheduler = new TaskScheduler()

// Legacy function exports for compatibility
export async function executeScheduledTask(scheduleId: string, taskId: string): Promise<void> {
  await taskScheduler.executeScheduledTask(scheduleId, taskId)
}

export async function processScheduledTasks(): Promise<void> {
  await taskScheduler.processScheduledTasks()
}
