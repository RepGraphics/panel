import { useDrizzle, tables, eq, and } from './drizzle'
import { getWingsClient } from './wings-client'
import { recordAuditEvent } from './audit'
import { randomUUID } from 'crypto'
import type {
  TransferManagerOptions,
  TransferInfo,
  TransferState,
  CreateTransferOptions,
  TransferValidation,
} from '#shared/types/server-transfers'

export class TransferManager {
  private db = useDrizzle()

  async validateTransfer(options: CreateTransferOptions): Promise<TransferValidation> {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      // Get server details
      const server = await this.db
        .select()
        .from(tables.servers)
        .where(eq(tables.servers.uuid, options.serverUuid))
        .get()

      if (!server) {
        errors.push('Server not found')
        return { isValid: false, errors, warnings }
      }

      // Check if server is already being transferred
      const existingTransfer = await this.db
        .select()
        .from(tables.serverTransfers)
        .where(and(
          eq(tables.serverTransfers.serverId, server.id),
          eq(tables.serverTransfers.archived, false)
        ))
        .get()

      if (existingTransfer) {
        errors.push('Server is already being transferred')
      }

      // Check if server is suspended
      if (server.suspended) {
        warnings.push('Server is suspended - transfer may fail')
      }

      // Validate new node exists and is available
      const newNode = await this.db
        .select()
        .from(tables.wingsNodes)
        .where(eq(tables.wingsNodes.id, options.newNodeId))
        .get()

      if (!newNode) {
        errors.push('Target node not found')
        return { isValid: false, errors, warnings }
      }

      if (newNode.maintenanceMode) {
        errors.push('Target node is in maintenance mode')
      }

      // Check if transferring to same node
      if (server.nodeId === options.newNodeId) {
        errors.push('Cannot transfer server to the same node')
      }

      // Validate new allocation
      const newAllocation = await this.db
        .select()
        .from(tables.serverAllocations)
        .where(eq(tables.serverAllocations.id, options.newAllocationId))
        .get()

      if (!newAllocation) {
        errors.push('Target allocation not found')
      } else {
        if (newAllocation.serverId) {
          errors.push('Target allocation is already in use')
        }
        if (newAllocation.nodeId !== options.newNodeId) {
          errors.push('Target allocation does not belong to target node')
        }
      }

      // Validate additional allocations if provided
      if (options.newAdditionalAllocations?.length) {
        for (const allocId of options.newAdditionalAllocations) {
          const allocation = await this.db
            .select()
            .from(tables.serverAllocations)
            .where(eq(tables.serverAllocations.id, allocId))
            .get()

          if (!allocation) {
            errors.push(`Additional allocation ${allocId} not found`)
          } else if (allocation.serverId) {
            errors.push(`Additional allocation ${allocId} is already in use`)
          } else if (allocation.nodeId !== options.newNodeId) {
            errors.push(`Additional allocation ${allocId} does not belong to target node`)
          }
        }
      }

      // Check node resources (basic check)
      const nodeServers = await this.db
        .select()
        .from(tables.servers)
        .where(eq(tables.servers.nodeId, options.newNodeId))
        .all()

      if (nodeServers.length >= 50) { // Arbitrary limit
        warnings.push('Target node has many servers - performance may be affected')
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
      }
    } catch (error) {
      errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return { isValid: false, errors, warnings }
    }
  }

  async createTransfer(options: CreateTransferOptions): Promise<TransferInfo> {
    // Validate transfer first
    const validation = await this.validateTransfer(options)
    if (!validation.isValid) {
      throw new Error(`Transfer validation failed: ${validation.errors.join(', ')}`)
    }

    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.uuid, options.serverUuid))
      .get()

    if (!server) {
      throw new Error('Server not found')
    }

    const transferId = randomUUID()
    const now = new Date()

    // Get current allocations
    const currentAllocations = await this.db
      .select()
      .from(tables.serverAllocations)
      .where(eq(tables.serverAllocations.serverId, server.id))
      .all()

    const primaryAllocation = currentAllocations.find(a => a.isPrimary)
    const additionalAllocations = currentAllocations.filter(a => !a.isPrimary)

    const transferRecord = {
      id: transferId,
      serverId: server.id,
      oldNode: server.nodeId!,
      newNode: options.newNodeId,
      oldAllocation: primaryAllocation?.id || '',
      newAllocation: options.newAllocationId,
      oldAdditionalAllocations: additionalAllocations.length > 0 
        ? JSON.stringify(additionalAllocations.map(a => a.id))
        : null,
      newAdditionalAllocations: options.newAdditionalAllocations?.length
        ? JSON.stringify(options.newAdditionalAllocations)
        : null,
      successful: undefined,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }

    await this.db.insert(tables.serverTransfers).values(transferRecord)

    // Update server status
    await this.db
      .update(tables.servers)
      .set({
        status: 'transferring',
        updatedAt: now,
      })
      .where(eq(tables.servers.id, server.id))
      .run()

    if (!options.skipAudit && options.userId) {
      await recordAuditEvent({
        actor: options.userId,
        actorType: 'user',
        action: 'server.transfer.create',
        targetType: 'server',
        targetId: server.id,
        metadata: {
          transferId,
          oldNodeId: server.nodeId,
          newNodeId: options.newNodeId,
          oldAllocationId: primaryAllocation?.id,
          newAllocationId: options.newAllocationId,
        },
      })
    }

    return {
      id: transferId,
      serverId: server.id,
      serverUuid: server.uuid,
      oldNodeId: server.nodeId!,
      newNodeId: options.newNodeId,
      oldAllocationId: primaryAllocation?.id || '',
      newAllocationId: options.newAllocationId,
      oldAdditionalAllocations: additionalAllocations.map(a => a.id),
      newAdditionalAllocations: options.newAdditionalAllocations,
      status: 'pending',
      successful: undefined,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }
  }

  async startTransfer(transferId: string, options: TransferManagerOptions = {}): Promise<void> {
    const transfer = await this.db
      .select()
      .from(tables.serverTransfers)
      .where(eq(tables.serverTransfers.id, transferId))
      .get()

    if (!transfer) {
      throw new Error('Transfer not found')
    }

    if (transfer.archived) {
      throw new Error('Transfer is already archived')
    }

    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.id, transfer.serverId))
      .get()

    if (!server) {
      throw new Error('Server not found')
    }

    try {
      // Update transfer status to processing
      await this.db
        .update(tables.serverTransfers)
        .set({
          updatedAt: new Date(),
        })
        .where(eq(tables.serverTransfers.id, transferId))
        .run()

      // Get source node Wings client
      const sourceNode = await this.db
        .select()
        .from(tables.wingsNodes)
        .where(eq(tables.wingsNodes.id, transfer.oldNode))
        .get()

      if (!sourceNode) {
        throw new Error('Source node not found')
      }

      // Get target node Wings client  
      const targetNode = await this.db
        .select()
        .from(tables.wingsNodes)
        .where(eq(tables.wingsNodes.id, transfer.newNode))
        .get()

      if (!targetNode) {
        throw new Error('Target node not found')
      }

      const _sourceWingsNode = {
        id: sourceNode.id,
        fqdn: sourceNode.fqdn,
        scheme: sourceNode.scheme as 'http' | 'https',
        daemonListen: sourceNode.daemonListen,
        daemonSftp: sourceNode.daemonSftp,
        daemonBase: sourceNode.daemonBase,
        tokenId: sourceNode.tokenIdentifier,
        token: sourceNode.tokenSecret,
      }

      const targetWingsNode = {
        id: targetNode.id,
        fqdn: targetNode.fqdn,
        scheme: targetNode.scheme as 'http' | 'https',
        daemonListen: targetNode.daemonListen,
        daemonSftp: targetNode.daemonSftp,
        daemonBase: targetNode.daemonBase,
        tokenId: targetNode.tokenIdentifier,
        token: targetNode.tokenSecret,
      }

      const targetClient = getWingsClient(targetWingsNode)

      // Initiate transfer on Wings
      // Note: This is a simplified version - real implementation would need
      // to handle the complex transfer protocol between Wings daemons
      
      // 1. Create server on target node
      const serverConfig = {
        uuid: server.uuid,
        // ... other server configuration
      }
      
      await targetClient.createServer(server.uuid, serverConfig)
      
      // 2. Transfer would happen via Wings-to-Wings communication
      // This is handled by Wings internally using their transfer protocol
      
      // For now, we'll simulate the transfer completion
      await this.completeTransfer(transferId, true, options)

    } catch (error) {
      console.error('Transfer failed:', error)
      await this.completeTransfer(transferId, false, options)
      throw error
    }
  }

  async completeTransfer(
    transferId: string, 
    successful: boolean, 
    options: TransferManagerOptions = {}
  ): Promise<void> {
    const transfer = await this.db
      .select()
      .from(tables.serverTransfers)
      .where(eq(tables.serverTransfers.id, transferId))
      .get()

    if (!transfer) {
      throw new Error('Transfer not found')
    }

    const now = new Date()

    if (successful) {
      // Update server to point to new node and allocation
      await this.db
        .update(tables.servers)
        .set({
          nodeId: transfer.newNode,
          allocationId: transfer.newAllocation,
          status: 'installing', // Server will need to be reinstalled on new node
          updatedAt: now,
        })
        .where(eq(tables.servers.id, transfer.serverId))
        .run()

      // Update allocations
      // Free old allocations
      await this.db
        .update(tables.serverAllocations)
        .set({
          serverId: null,
          isPrimary: false,
          updatedAt: now,
        })
        .where(eq(tables.serverAllocations.serverId, transfer.serverId))
        .run()

      // Assign new primary allocation
      await this.db
        .update(tables.serverAllocations)
        .set({
          serverId: transfer.serverId,
          isPrimary: true,
          updatedAt: now,
        })
        .where(eq(tables.serverAllocations.id, transfer.newAllocation))
        .run()

      // Assign additional allocations if any
      if (transfer.newAdditionalAllocations) {
        const additionalIds = JSON.parse(transfer.newAdditionalAllocations) as string[]
        for (const allocId of additionalIds) {
          await this.db
            .update(tables.serverAllocations)
            .set({
              serverId: transfer.serverId,
              isPrimary: false,
              updatedAt: now,
            })
            .where(eq(tables.serverAllocations.id, allocId))
            .run()
        }
      }
    } else {
      // Transfer failed - restore server status
      await this.db
        .update(tables.servers)
        .set({
          status: 'transfer_failed',
          updatedAt: now,
        })
        .where(eq(tables.servers.id, transfer.serverId))
        .run()
    }

    // Update transfer record
    await this.db
      .update(tables.serverTransfers)
      .set({
        successful,
        archived: true,
        updatedAt: now,
      })
      .where(eq(tables.serverTransfers.id, transferId))
      .run()

    if (!options.skipAudit && options.userId) {
      await recordAuditEvent({
        actor: options.userId,
        actorType: 'user',
        action: successful ? 'server.transfer.complete' : 'server.transfer.fail',
        targetType: 'server',
        targetId: transfer.serverId,
        metadata: {
          transferId,
          successful,
        },
      })
    }
  }

  async cancelTransfer(transferId: string, options: TransferManagerOptions = {}): Promise<void> {
    const transfer = await this.db
      .select()
      .from(tables.serverTransfers)
      .where(eq(tables.serverTransfers.id, transferId))
      .get()

    if (!transfer) {
      throw new Error('Transfer not found')
    }

    if (transfer.archived) {
      throw new Error('Transfer is already completed')
    }

    // Update server status
    await this.db
      .update(tables.servers)
      .set({
        status: null, // Reset to normal
        updatedAt: new Date(),
      })
      .where(eq(tables.servers.id, transfer.serverId))
      .run()

    // Archive transfer as cancelled
    await this.db
      .update(tables.serverTransfers)
      .set({
        successful: false,
        archived: true,
        updatedAt: new Date(),
      })
      .where(eq(tables.serverTransfers.id, transferId))
      .run()

    if (!options.skipAudit && options.userId) {
      await recordAuditEvent({
        actor: options.userId,
        actorType: 'user',
        action: 'server.transfer.cancel',
        targetType: 'server',
        targetId: transfer.serverId,
        metadata: { transferId },
      })
    }
  }

  async getTransfer(transferId: string): Promise<TransferInfo | null> {
    const transfer = await this.db
      .select()
      .from(tables.serverTransfers)
      .where(eq(tables.serverTransfers.id, transferId))
      .get()

    if (!transfer) {
      return null
    }

    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.id, transfer.serverId))
      .get()

    let status: TransferState = 'pending'
    if (transfer.archived) {
      status = transfer.successful ? 'completed' : 'failed'
    } else {
      // Check server status to determine transfer status
      if (server?.status === 'transferring') {
        status = 'processing'
      }
    }

    return {
      id: transfer.id,
      serverId: transfer.serverId,
      serverUuid: server?.uuid || '',
      oldNodeId: transfer.oldNode,
      newNodeId: transfer.newNode,
      oldAllocationId: transfer.oldAllocation,
      newAllocationId: transfer.newAllocation,
      oldAdditionalAllocations: transfer.oldAdditionalAllocations 
        ? JSON.parse(transfer.oldAdditionalAllocations)
        : undefined,
      newAdditionalAllocations: transfer.newAdditionalAllocations
        ? JSON.parse(transfer.newAdditionalAllocations)
        : undefined,
      status,
      successful: transfer.successful ?? undefined,
      archived: transfer.archived,
      createdAt: transfer.createdAt,
      updatedAt: transfer.updatedAt,
    }
  }

  async listTransfers(serverId?: string): Promise<TransferInfo[]> {
    const query = this.db.select().from(tables.serverTransfers)
    
    if (serverId) {
      query.where(eq(tables.serverTransfers.serverId, serverId))
    }
    
    const transfers = await query.orderBy(tables.serverTransfers.createdAt).all()
    
    const results: TransferInfo[] = []
    for (const transfer of transfers) {
      const transferInfo = await this.getTransfer(transfer.id)
      if (transferInfo) {
        results.push(transferInfo)
      }
    }
    
    return results
  }
}

// Export singleton instance
export const transferManager = new TransferManager()
