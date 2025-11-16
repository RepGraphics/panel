export interface EggImportData {
  name: string
  author?: string
  description?: string
  docker_images?: Record<string, string>
  startup?: string
  config?: {
    files?: Record<string, unknown>
    startup?: Record<string, unknown>
    logs?: Record<string, unknown>
    stop?: string
  }
  scripts?: {
    installation?: {
      script?: string
      container?: string
      entrypoint?: string
    }
  }
  variables?: Array<{
    name: string
    description?: string
    env_variable: string
    default_value?: string
    user_viewable?: boolean
    user_editable?: boolean
    rules?: string
  }>
}

export interface EggImportResponse {
  success: boolean
  data: {
    id: string
  }
}
