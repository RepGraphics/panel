export interface SSHKeyManagerOptions {
  userId?: string
  skipAudit?: boolean
}

export interface SSHKeyInfo {
  id: string
  userId: string
  name: string
  fingerprint: string
  publicKey: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateSSHKeyOptions extends SSHKeyManagerOptions {
  name: string
  publicKey: string
}
