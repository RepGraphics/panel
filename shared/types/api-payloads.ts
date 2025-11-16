

export interface CommandRequest {
  command: string
}

export interface UpdateVariablePayload {
  value: string
}

export interface CreateDatabasePayload {
  name: string
  remote: string
}

export interface CreateSubuserPayload {
  email: string
  permissions: string[]
}

export interface UpdateSubuserPayload {
  permissions: string[]
}

export interface CreateAllocationPayload {
  allocationId: string
}

export interface UpdateAllocationPayload {
  notes?: string
}

export interface CreateSchedulePayload {
  name: string
  cron: {
    minute: string
    hour: string
    day_of_month: string
    month: string
    day_of_week: string
  }
  is_active: boolean
  only_when_online: boolean
}

export interface UpdateSchedulePayload {
  name?: string
  cron?: {
    minute: string
    hour: string
    day_of_month: string
    month: string
    day_of_week: string
  }
  is_active?: boolean
  only_when_online?: boolean
}

export interface CreateTaskPayload {
  action: string
  payload: string
  time_offset?: number
}

export interface UpdateNodePayload {
  name?: string
  description?: string
  fqdn?: string
  scheme?: 'http' | 'https'
  behindProxy?: boolean
  public?: boolean
  maintenanceMode?: boolean
  memory?: number
}
