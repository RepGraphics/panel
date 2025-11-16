export interface WingsError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface WingsServerDetails {
  state: string
  isSuspended: boolean
  utilization: {
    memory_bytes: number
    memory_limit_bytes: number
    cpu_absolute: number
    network: {
      rx_bytes: number
      tx_bytes: number
    }
    uptime: number
    disk_bytes: number
  }
}
