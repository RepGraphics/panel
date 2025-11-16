export interface ServerStartupVariable {
  id: string
  serverId: string
  key: string
  value: string
  description: string | null
  isEditable: boolean
  createdAt: string
  updatedAt: string
}

export interface StartupForm {
  startup: string
  dockerImage: string
  environment: Record<string, string>
}

export interface EnvironmentEntry {
  key: string
  value: string
}

export type EnvironmentInputValue = string | number | boolean | null | undefined

export interface UpdateStartupVariablePayload {
  value: string
}

export interface UpdateStartupVariableResponse {
  success: boolean
  data: ServerStartupVariable
}
