import { resourceMonitor } from '~~/server/utils/resource-monitor'

export default defineTask({
  meta: {
    name: 'monitoring:collect-resources',
    description: 'Collect server and node resource statistics',
  },
  async run({ payload: _payload, context: _context }) {
    const startTime = Date.now()
    
    try {
      console.log(`[${new Date().toISOString()}] Starting resource collection...`)

      // Collect server resources
      const serverResources = await resourceMonitor.getAllServerResources()
      console.log(`Collected resources for ${serverResources.length} servers`)

      // Collect node resources
      const nodeResources = await resourceMonitor.getAllNodeResources()
      const onlineNodes = nodeResources.filter(node => node.status === 'online' || node.status === 'maintenance')
      const offlineNodes = nodeResources.filter(node => node.status === 'offline')

      console.log(`Collected resources for ${nodeResources.length} nodes (${onlineNodes.length} online, ${offlineNodes.length} offline)${offlineNodes.length > 0 ? ' - review offline nodes in admin dashboard' : ''}`)

      if (offlineNodes.length > 0) {
        for (const node of offlineNodes) {
          console.warn(`[monitoring] Wings node ${node.nodeId} unreachable: ${node.message ?? 'no details provided'}`)
        }
      }

      const duration = Date.now() - startTime
      
      const result = {
        collectedAt: new Date().toISOString(),
        duration,
        servers: {
          total: serverResources.length,
          online: serverResources.filter(s => s.state === 'running').length,
          offline: serverResources.filter(s => s.state === 'offline').length,
        },
        nodes: {
          total: nodeResources.length,
          totalMemory: nodeResources.reduce((sum, n) => sum + n.totalMemory, 0),
          usedMemory: nodeResources.reduce((sum, n) => sum + n.usedMemory, 0),
          totalServers: nodeResources.reduce((sum, n) => sum + n.serverCount, 0),
        },
      }

      console.log(`[${new Date().toISOString()}] Resource collection completed in ${duration}ms:`, result)
      return { result }

    } catch (error) {
      const errorMsg = `Resource collection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(errorMsg)
      throw new Error(errorMsg)
    }
  },
})
