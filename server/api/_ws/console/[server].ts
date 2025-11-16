import type { H3Event } from 'h3'
import { getWingsClientForServer } from '~~/server/utils/wings-client'
import { useDrizzle, tables, eq } from '~~/server/utils/drizzle'
import { getServerSession } from '#auth'
import { resolveSessionUser } from '~~/server/utils/auth/sessionUser'
import { permissionManager } from '~~/server/utils/permission-manager'

// Store authenticated connections with user context
const connections = new Map<string, { 
  serverId: string; 
  serverUuid: string; 
  userId: string;
  authenticated: boolean 
}>()

export default defineWebSocketHandler({
  async open(peer) {
    console.log('WebSocket console connection opened:', peer.id)
  },

  async message(peer, message) {
    try {
      const data = JSON.parse(message.text())
      const { type, serverId, token, payload } = data

      if (!serverId) {
        peer.send(JSON.stringify({
          type: 'error',
          message: 'Server ID is required'
        }))
        return
      }

      // Get server details
      const db = useDrizzle()
      const server = await db
        .select()
        .from(tables.servers)
        .where(eq(tables.servers.id, serverId))
        .get()

      if (!server) {
        peer.send(JSON.stringify({
          type: 'error',
          message: 'Server not found'
        }))
        return
      }

      const { client } = await getWingsClientForServer(server.uuid)

      switch (type) {
        case 'auth': {
          // Authenticate using Nuxt Auth session
          try {
            // Create a mock event with the token for session validation
            const mockEvent = {
              node: {
                req: {
                  headers: {
                    authorization: `Bearer ${token}`,
                    cookie: token // Pass token as cookie for session validation
                  }
                }
              }
            } as H3Event

            const session = await getServerSession(mockEvent)
            const user = resolveSessionUser(session)
            
            if (!user?.id) {
              peer.send(JSON.stringify({
                type: 'auth_error',
                message: 'Invalid session token'
              }))
              return
            }

            // Check if user has console permission for this server
            const permissionCheck = await permissionManager.checkPermission(user.id, 'server.console', serverId)
            if (!permissionCheck.hasPermission) {
              peer.send(JSON.stringify({
                type: 'auth_error',
                message: `Insufficient permissions: ${permissionCheck.reason}`
              }))
              return
            }

            // Store authenticated connection
            connections.set(peer.id, {
              serverId,
              serverUuid: server.uuid,
              userId: user.id,
              authenticated: true
            })

            peer.send(JSON.stringify({
              type: 'auth_success',
              data: { 
                serverUuid: server.uuid,
                userId: user.id
              }
            }))

          } catch (error) {
            console.error('WebSocket auth error:', error)
            peer.send(JSON.stringify({
              type: 'auth_error',
              message: 'Authentication failed'
            }))
          }
          break
        }

        case 'command': {
          // Send command to server
          const connection = connections.get(peer.id)
          if (!connection?.authenticated) {
            peer.send(JSON.stringify({
              type: 'error',
              message: 'Not authenticated'
            }))
            return
          }

          try {
            await client.sendCommand(server.uuid, payload.command || '')
            peer.send(JSON.stringify({
              type: 'command_sent',
              data: { command: payload.command }
            }))
          } catch (error) {
            peer.send(JSON.stringify({
              type: 'command_error',
              message: error instanceof Error ? error.message : 'Command failed'
            }))
          }
          break
        }

        case 'status': {
          // Get server status
          const statusConnection = connections.get(peer.id)
          if (!statusConnection?.authenticated) {
            peer.send(JSON.stringify({
              type: 'error',
              message: 'Not authenticated'
            }))
            return
          }

          try {
            const details = await client.getServerDetails(server.uuid)
            peer.send(JSON.stringify({
              type: 'status_data',
              data: { state: details.state, isSuspended: details.isSuspended }
            }))
          } catch (error) {
            peer.send(JSON.stringify({
              type: 'status_error',
              message: error instanceof Error ? error.message : 'Failed to get status'
            }))
          }
          break
        }

        default:
          peer.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${type}`
          }))
      }

    } catch (error) {
      console.error('WebSocket message error:', error)
      peer.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }))
    }
  },

  async close(peer) {
    console.log('WebSocket console connection closed:', peer.id)
    connections.delete(peer.id)
  },

  async error(peer, error) {
    console.error('WebSocket console error:', error)
    connections.delete(peer.id)
    peer.send(JSON.stringify({
      type: 'error',
      message: 'WebSocket error occurred'
    }))
  }
})
