export interface ServerStatus {
  serverId: string
  serverUuid: string
  state: string
  isOnline: boolean
  isSuspended: boolean
  utilization?: {
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
  lastChecked: Date
  error?: string
}
