export interface ServerTransferConfig {
  serverId: string
  targetNodeId: string
  targetAllocationId: string
}

export type TransferState = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface TransferStatus {
  id: string
  status: TransferState
  progress: number
  message: string
}

export interface TransferManagerOptions {
  userId?: string
  skipAudit?: boolean
}

export interface TransferInfo {
  id: string
  serverId: string
  serverUuid: string
  oldNodeId: string
  newNodeId: string
  oldAllocationId: string
  newAllocationId: string
  oldAdditionalAllocations?: string[]
  newAdditionalAllocations?: string[]
  status: TransferState
  successful?: boolean
  archived: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateTransferOptions extends TransferManagerOptions {
  serverUuid: string
  newNodeId: string
  newAllocationId: string
  newAdditionalAllocations?: string[]
}

export interface TransferValidation {
  isValid: boolean
  errors: string[]
  warnings: string[]
}
