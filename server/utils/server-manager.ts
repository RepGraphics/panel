import { useDrizzle, tables, eq } from './drizzle'
import { getWingsClientForServer, WingsConnectionError, WingsAuthError } from './wings-client'
import { getServerStatus, updateServerStatus } from './server-status'
import { provisionServerOnWings, waitForServerInstall } from './server-provisioning'
import { recordAuditEvent } from './audit'
import type { WingsClient } from './wings-client'
import type { ServerManagerOptions } from '#shared/types/server-manager'

export class ServerManager {
  private db = useDrizzle()

  private async waitForServerDeletion(client: WingsClient, serverUuid: string): Promise<void> {
    const maxRetries = 20
    const delayMs = 3000

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await client.getServerDetails(serverUuid)
      } catch (error) {
        if (error instanceof WingsConnectionError && error.message.includes('404')) {
          return
        }

        if (error instanceof WingsAuthError) {
          throw error
        }
      }

      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    throw new Error('Timed out waiting for Wings to delete server')
  }

  async createServer(config: {
    serverId: string
    serverUuid: string
    eggId: string
    nodeId: string
    allocationId: string
    environment?: Record<string, string>
  }, options: ServerManagerOptions = {}): Promise<void> {
    try {
      await provisionServerOnWings(config)
      
      if (!options.skipAudit && options.userId) {
        await recordAuditEvent({
          actor: options.userId,
          actorType: 'user',
          action: 'server.create',
          targetType: 'server',
          targetId: config.serverId,
          metadata: { serverUuid: config.serverUuid },
        })
      }
    } catch (error) {
      // Update server status to failed
      await this.db
        .update(tables.servers)
        .set({
          status: 'install_failed',
          updatedAt: new Date(),
        })
        .where(eq(tables.servers.id, config.serverId))
        .run()

      throw error
    }
  }

  async deleteServer(serverUuid: string, options: ServerManagerOptions = {}): Promise<void> {
    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.uuid, serverUuid))
      .get()

    if (!server) {
      throw new Error('Server not found')
    }

    try {
      await this.db
        .update(tables.servers)
        .set({
          status: 'deleting',
          updatedAt: new Date(),
        })
        .where(eq(tables.servers.uuid, serverUuid))
        .run()

      const { client } = await getWingsClientForServer(serverUuid)
      await client.deleteServer(serverUuid)

      await this.waitForServerDeletion(client, serverUuid)

      // Remove from database
      await this.db
        .delete(tables.servers)
        .where(eq(tables.servers.uuid, serverUuid))
        .run()

      if (!options.skipAudit && options.userId) {
        await recordAuditEvent({
          actor: options.userId,
          actorType: 'user',
          action: 'server.delete',
          targetType: 'server',
          targetId: server.id,
          metadata: { serverUuid },
        })
      }
    } catch (error) {
      await this.db
        .update(tables.servers)
        .set({
          status: 'deletion_failed',
          updatedAt: new Date(),
        })
        .where(eq(tables.servers.uuid, serverUuid))
        .run()

      if (error instanceof WingsConnectionError) {
        console.warn(`Wings unavailable during server deletion: ${serverUuid}`, error)
      }

      throw error
    }
  }

  async powerAction(
    serverUuid: string, 
    action: 'start' | 'stop' | 'restart' | 'kill',
    options: ServerManagerOptions = {}
  ): Promise<void> {
    const { client, server } = await getWingsClientForServer(serverUuid)
    
    await client.sendPowerAction(serverUuid, action)

    // Update server status after power action
    setTimeout(() => {
      updateServerStatus(serverUuid).catch(error => {
        console.error(`Failed to update status after power action for ${serverUuid}:`, error)
      })
    }, 2000) // Wait 2 seconds for state to change

    if (!options.skipAudit && options.userId) {
      await recordAuditEvent({
        actor: options.userId,
        actorType: 'user',
        action: `server.power.${action}`,
        targetType: 'server',
        targetId: server.id as string,
        metadata: { action, serverUuid },
      })
    }
  }

  async reinstallServer(serverUuid: string, options: ServerManagerOptions = {}): Promise<void> {
    const { client, server } = await getWingsClientForServer(serverUuid)

    const now = new Date()

    await this.db
      .update(tables.servers)
      .set({
        status: 'installing',
        installedAt: null,
        updatedAt: now,
      })
      .where(eq(tables.servers.uuid, serverUuid))
      .run()

    try {
      await client.reinstallServer(serverUuid)
      await waitForServerInstall(client, serverUuid)

      await this.db
        .update(tables.servers)
        .set({
          status: 'installed',
          installedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tables.servers.uuid, serverUuid))
        .run()

      if (!options.skipAudit && options.userId) {
        await recordAuditEvent({
          actor: options.userId,
          actorType: 'user',
          action: 'server.reinstall',
          targetType: 'server',
          targetId: server.id as string,
          metadata: { serverUuid },
        })
      }
    } catch (error) {
      await this.db
        .update(tables.servers)
        .set({
          status: 'install_failed',
          updatedAt: new Date(),
        })
        .where(eq(tables.servers.uuid, serverUuid))
        .run()

      throw error
    }
  }

  async suspendServer(serverUuid: string, options: ServerManagerOptions = {}): Promise<void> {
    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.uuid, serverUuid))
      .get()

    if (!server) {
      throw new Error('Server not found')
    }

    // Stop the server first
    try {
      await this.powerAction(serverUuid, 'stop', { ...options, skipAudit: true })
    } catch (error) {
      console.warn(`Failed to stop server during suspension: ${error}`)
    }

    // Update suspension status
    await this.db
      .update(tables.servers)
      .set({
        suspended: true,
        updatedAt: new Date(),
      })
      .where(eq(tables.servers.uuid, serverUuid))
      .run()

    if (!options.skipAudit && options.userId) {
      await recordAuditEvent({
        actor: options.userId,
        actorType: 'user',
        action: 'server.suspend',
        targetType: 'server',
        targetId: server.id,
        metadata: { serverUuid },
      })
    }
  }

  async unsuspendServer(serverUuid: string, options: ServerManagerOptions = {}): Promise<void> {
    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.uuid, serverUuid))
      .get()

    if (!server) {
      throw new Error('Server not found')
    }

    // Update suspension status
    await this.db
      .update(tables.servers)
      .set({
        suspended: false,
        updatedAt: new Date(),
      })
      .where(eq(tables.servers.uuid, serverUuid))
      .run()

    if (!options.skipAudit && options.userId) {
      await recordAuditEvent({
        actor: options.userId,
        actorType: 'user',
        action: 'server.unsuspend',
        targetType: 'server',
        targetId: server.id,
        metadata: { serverUuid },
      })
    }
  }

  async getServerWithStatus(serverUuid: string) {
    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.uuid, serverUuid))
      .get()

    if (!server) {
      throw new Error('Server not found')
    }

    const status = await getServerStatus(serverUuid)

    return {
      ...server,
      realTimeStatus: status,
    }
  }
}

// Export singleton instance
export const serverManager = new ServerManager()
