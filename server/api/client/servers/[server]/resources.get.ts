import { getWingsClientForServer } from '~~/server/utils/wings-client'
import { requirePermission } from '~~/server/utils/permission-middleware'

export default defineEventHandler(async (event) => {
  const serverIdentifier = getRouterParam(event, 'server')
  if (!serverIdentifier) {
    throw createError({ statusCode: 400, statusMessage: 'Server identifier required' })
  }

  // Check permissions - user must have server view access
  await requirePermission(event, 'server.view', serverIdentifier)

  try {

    const { client, server } = await getWingsClientForServer(serverIdentifier)
    const details = await client.getServerResources(server.uuid as string)

    return {
      current_state: details.state || 'offline',
      is_suspended: details.isSuspended,
      resources: {
        memory_bytes: details.utilization.memory_bytes,
        memory_limit_bytes: details.utilization.memory_limit_bytes,
        cpu_absolute: details.utilization.cpu_absolute,
        disk_bytes: details.utilization.disk_bytes,
        network_rx_bytes: details.utilization.network.rx_bytes,
        network_tx_bytes: details.utilization.network.tx_bytes,
        uptime: details.utilization.uptime,
        state: details.state,
      },
    }
  } catch (error) {
    console.error('Wings resource fetch failed:', error)

    return {
      current_state: 'offline',
      is_suspended: false,
      resources: {
        memory_bytes: 0,
        memory_limit_bytes: 0,
        cpu_absolute: 0,
        disk_bytes: 0,
        network_rx_bytes: 0,
        network_tx_bytes: 0,
        uptime: 0,
        state: 'offline',
      },
    }
  }
})
