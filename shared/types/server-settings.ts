import type { ServerLimits, ServerInfo } from './server'

export interface SettingsData {
  server: ServerInfo
  limits: ServerLimits | null
}

export interface RenameServerPayload {
  name: string
}

export interface RenameServerResponse {
  success: boolean
  data: {
    name: string
  }
}
