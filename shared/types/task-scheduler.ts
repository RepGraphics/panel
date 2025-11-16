export type { PowerAction } from './server-console'

export type TaskAction = 'command' | 'power' | 'backup'

export interface ScheduleTask {
  id: string
  action: TaskAction
  payload: string
  timeOffset: number
  sequenceId: number
  continueOnFailure: boolean
  isQueued: boolean
}

export interface ScheduleInfo {
  id: string
  serverId: string
  serverUuid: string
  name: string
  cron: string
  enabled: boolean
  nextRunAt?: Date
  lastRunAt?: Date
  tasks: ScheduleTask[]
  createdAt: Date
  updatedAt: Date
}

export interface TaskExecutionResult {
  taskId: string
  success: boolean
  output?: string
  error?: string
  executedAt: Date
}

export interface ScheduleExecutionResult {
  scheduleId: string
  success: boolean
  tasks: TaskExecutionResult[]
  executedAt: Date
}
