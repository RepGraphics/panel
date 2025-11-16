import { useDrizzle, tables, eq } from './drizzle'
import { getWingsClientForServer, getWingsClient, WingsConnectionError, WingsAuthError } from './wings-client'
import type { ServerResourceStats, NodeResourceStats, NodeHealthStatus } from '#shared/types/server-resources'

export class ResourceMonitor {
  private db = useDrizzle()
  private monitoringInterval: NodeJS.Timeout | null = null
  private isMonitoring = false

  async getServerResources(serverId: string): Promise<ServerResourceStats | null> {
    try {
      const { client, server } = await getWingsClientForServer(serverId)
      const details = await client.getServerResources(server.uuid as string)

      return {
        serverId: server.id as string,
        serverUuid: server.uuid as string,
        state: details.state || 'offline',
        isSuspended: details.isSuspended,
        memoryBytes: details.utilization.memory_bytes,
        memoryLimitBytes: details.utilization.memory_limit_bytes,
        cpuAbsolute: details.utilization.cpu_absolute,
        diskBytes: details.utilization.disk_bytes,
        networkRxBytes: details.utilization.network.rx_bytes,
        networkTxBytes: details.utilization.network.tx_bytes,
        uptime: details.utilization.uptime,
        lastUpdated: new Date(),
      }
    } catch (error) {
      console.error(`Failed to get resources for server ${serverId}:`, error)
      return null
    }
  }

  async getNodeResources(nodeId: string): Promise<NodeResourceStats> {
    const node = await this.db
      .select()
      .from(tables.wingsNodes)
      .where(eq(tables.wingsNodes.id, nodeId))
      .get()

    if (!node) {
      return {
        nodeId,
        totalMemory: 0,
        usedMemory: 0,
        totalDisk: 0,
        usedDisk: 0,
        cpuCount: 0,
        cpuUsage: 0,
        serverCount: 0,
        lastUpdated: null,
        status: 'unknown',
        message: 'Node not registered in panel',
      }
    }

    const wingsNode = {
      id: node.id,
      fqdn: node.fqdn,
      scheme: node.scheme as 'http' | 'https',
      daemonListen: node.daemonListen,
      daemonSftp: node.daemonSftp,
      daemonBase: node.daemonBase,
      tokenId: node.tokenIdentifier,
      token: node.tokenSecret,
    }

    const client = getWingsClient(wingsNode)

    try {
      const systemInfo = await client.getSystemInfo()

      const serverCount = await this.db
        .select()
        .from(tables.servers)
        .where(eq(tables.servers.nodeId, nodeId))
        .all()

      const lastSeenAt = new Date()

      await this.db
        .update(tables.wingsNodes)
        .set({
          lastSeenAt,
          updatedAt: new Date(),
        })
        .where(eq(tables.wingsNodes.id, nodeId))
        .run()

      const status: NodeHealthStatus = node.maintenanceMode ? 'maintenance' : 'online'

      return {
        nodeId: node.id,
        totalMemory: Number(systemInfo.memory_total) || 0,
        usedMemory: Number(systemInfo.memory_used) || 0,
        totalDisk: Number(systemInfo.disk_total) || 0,
        usedDisk: Number(systemInfo.disk_used) || 0,
        cpuCount: Number(systemInfo.cpu_count) || 0,
        cpuUsage: Number(systemInfo.cpu_usage) || 0,
        serverCount: serverCount.length,
        lastUpdated: lastSeenAt,
        status,
      }
    } catch (error) {
      let status: NodeHealthStatus = 'offline'
      let message = 'Failed to contact Wings node'

      if (node.maintenanceMode) {
        status = 'maintenance'
        message = 'Node is in maintenance mode'
      } else if (error instanceof WingsAuthError) {
        status = 'offline'
        message = 'Authentication failed - verify node token'
      } else if (error instanceof WingsConnectionError) {
        status = 'offline'
        message = error.message
      } else if (error instanceof Error) {
        message = error.message
      }

      await this.db
        .update(tables.wingsNodes)
        .set({
          lastSeenAt: node.lastSeenAt ?? null,
          updatedAt: new Date(),
        })
        .where(eq(tables.wingsNodes.id, nodeId))
        .run()

      return {
        nodeId: node.id,
        totalMemory: 0,
        usedMemory: 0,
        totalDisk: 0,
        usedDisk: 0,
        cpuCount: 0,
        cpuUsage: 0,
        serverCount: 0,
        lastUpdated: node.lastSeenAt ? new Date(node.lastSeenAt) : null,
        status,
        message,
      }
    }
  }

  async getAllServerResources(): Promise<ServerResourceStats[]> {
    const servers = await this.db
      .select()
      .from(tables.servers)
      .all()

    const resources: ServerResourceStats[] = []

    for (const server of servers) {
      const stats = await this.getServerResources(server.id)
      if (stats) {
        resources.push(stats)
      }
    }

    return resources
  }

  async getAllNodeResources(): Promise<NodeResourceStats[]> {
    const nodes = await this.db
      .select()
      .from(tables.wingsNodes)
      .all()

    const resources: NodeResourceStats[] = []

    for (const node of nodes) {
      const stats = await this.getNodeResources(node.id)
      resources.push(stats)
    }

    return resources
  }

  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      console.log('Resource monitoring is already running')
      return
    }

    this.isMonitoring = true
    console.log(`Starting resource monitoring with ${intervalMs}ms interval`)

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectAllResources()
      } catch (error) {
        console.error('Resource monitoring cycle failed:', error)
      }
    }, intervalMs)
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }
    this.isMonitoring = false
    console.log('Resource monitoring stopped')
  }

  private async collectAllResources(): Promise<void> {
    const startTime = Date.now()
    
    try {
      // Collect server resources
      const serverResources = await this.getAllServerResources()
      console.log(`Collected resources for ${serverResources.length} servers`)

      // Collect node resources
      const nodeResources = await this.getAllNodeResources()
      const onlineNodes = nodeResources.filter(node => node.status === 'online' || node.status === 'maintenance')
      const offlineNodes = nodeResources.filter(node => node.status === 'offline')

      console.log(`Collected resources for ${nodeResources.length} nodes (${onlineNodes.length} online, ${offlineNodes.length} offline)`)

      if (offlineNodes.length > 0) {
        for (const offline of offlineNodes) {
          console.warn(`Node ${offline.nodeId} is offline: ${offline.message ?? 'unknown issue'}`)
        }
      }

      // Persist node status/health information
      for (const node of nodeResources) {
        await this.db
          .update(tables.wingsNodes)
          .set({
            lastSeenAt: node.lastUpdated ?? null,
            updatedAt: new Date(),
          })
          .where(eq(tables.wingsNodes.id, node.nodeId))
          .run()
      }

      // Update server statuses in database
      for (const resource of serverResources) {
        await this.db
          .update(tables.servers)
          .set({
            status: resource.state,
            updatedAt: new Date(),
          })
          .where(eq(tables.servers.id, resource.serverId))
          .run()
      }

      const duration = Date.now() - startTime
      console.log(`Resource collection completed in ${duration}ms`)

    } catch (error) {
      console.error('Failed to collect resources:', error)
    }
  }

  getMonitoringStatus(): { isMonitoring: boolean; intervalMs?: number } {
    return {
      isMonitoring: this.isMonitoring,
      intervalMs: this.monitoringInterval ? 30000 : undefined,
    }
  }
}

// Export singleton instance
export const resourceMonitor = new ResourceMonitor()
