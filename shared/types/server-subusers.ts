export interface ServerSubuser {
  id: string
  serverId: string
  userId: string
  username: string
  email: string
  permissions: string[]
  createdAt: string
  updatedAt: string
}

export interface UpdateServerSubuserPayload {
  permissions: string[]
}

export interface UpdateServerSubuserResponse {
  success: boolean
  data: ServerSubuser
}

export interface CreateServerSubuserPayload {
  email: string
  permissions: string[]
}

export interface CreateServerSubuserResponse {
  success: boolean
  data: ServerSubuser
}
