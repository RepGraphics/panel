export interface ServerResourceStats {
  serverId: string
  serverUuid: string
  state: string
  isSuspended: boolean
  memoryBytes: number
  memoryLimitBytes: number
  cpuAbsolute: number
  diskBytes: number
  networkRxBytes: number
  networkTxBytes: number
  uptime: number
  lastUpdated: Date
}

export type NodeHealthStatus = 'online' | 'offline' | 'maintenance' | 'unknown'

export interface NodeResourceStats {
  nodeId: string
  totalMemory: number
  usedMemory: number
  totalDisk: number
  usedDisk: number
  cpuCount: number
  cpuUsage: number
  serverCount: number
  lastUpdated: Date | null
  status: NodeHealthStatus
  message?: string | null
}

export interface NodeResourceUsage {
  memory: number
  disk: number
  serverCount: number
}
