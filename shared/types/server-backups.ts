export interface ServerBackup {
  id: string
  serverId: string
  uuid: string
  name: string
  ignoredFiles: string[]
  disk: 'wings' | 's3'
  checksum: string | null
  bytes: number
  isSuccessful: boolean
  isLocked: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateBackupPayload {
  name?: string
  locked?: boolean
}

export interface CreateBackupResponse {
  data: {
    id: string
    uuid: string
    name: string
    isLocked: boolean
    createdAt: string
  }
}
