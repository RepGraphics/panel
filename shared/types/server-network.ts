export interface ServerAllocation {
  id: string
  serverId: string
  ip: string
  ipAlias: string | null
  port: number
  notes: string | null
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

export interface NetworkData {
  primary: ServerAllocation | null
  allocations: ServerAllocation[]
}

export interface CreateServerAllocationPayload {
  allocationId: string
}

export interface CreateServerAllocationResponse {
  success: boolean
  data: {
    id: string
    serverId: string
    ip: string
    port: number
    isPrimary: boolean
    createdAt: string
  }
}
