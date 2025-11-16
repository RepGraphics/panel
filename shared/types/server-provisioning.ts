export interface ServerProvisioningConfig {
  serverId: string
  serverUuid: string
  eggId: string
  nodeId: string
  allocationId: string
  environment?: Record<string, string>
  additionalAllocationIds?: string[]
  mountIds?: string[]
  dockerImageOverride?: string
  dockerCredentials?: {
    registry?: string
    username?: string
    password?: string
    imagePullPolicy?: string
  }
}
