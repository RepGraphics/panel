import { useDrizzle, tables, eq, and } from './drizzle'

export type Permission =
  | 'server.view'
  | 'server.console'
  | 'server.power'
  | 'server.command'
  | 'server.files.read'
  | 'server.files.write'
  | 'server.files.delete'
  | 'server.files.upload'
  | 'server.files.download'
  | 'server.files.compress'
  | 'server.backup.create'
  | 'server.backup.restore'
  | 'server.backup.delete'
  | 'server.backup.download'
  | 'server.database.create'
  | 'server.database.read'
  | 'server.database.update'
  | 'server.database.delete'
  | 'server.schedule.create'
  | 'server.schedule.read'
  | 'server.schedule.update'
  | 'server.schedule.delete'
  | 'server.settings.read'
  | 'server.settings.update'
  | 'server.users.read'
  | 'server.users.create'
  | 'server.users.update'
  | 'server.users.delete'
  | 'server.files.*'
  | 'server.backup.*'
  | 'server.database.*'
  | 'server.schedule.*'
  | 'server.users.*'
  | 'control.console'
  | 'control.start'
  | 'control.stop'
  | 'control.restart'
  | 'control.power'
  | 'user.create'
  | 'user.read'
  | 'user.update'
  | 'user.delete'
  | 'file.create'
  | 'file.read'
  | 'file.update'
  | 'file.delete'
  | 'file.archive'
  | 'file.sftp'
  | 'backup.create'
  | 'backup.read'
  | 'backup.delete'
  | 'backup.download'
  | 'backup.restore'
  | 'allocation.read'
  | 'allocation.create'
  | 'allocation.update'
  | 'allocation.delete'
  | 'startup.read'
  | 'startup.update'
  | 'database.create'
  | 'database.read'
  | 'database.update'
  | 'database.delete'
  | 'database.view_password'
  | 'schedule.create'
  | 'schedule.read'
  | 'schedule.update'
  | 'schedule.delete'
  | 'settings.rename'
  | 'settings.reinstall'
  | 'admin.*'
  | 'admin.servers.*'
  | 'admin.users.*'
  | 'admin.nodes.*'
  | 'admin.locations.*'
  | 'admin.nests.*'
  | 'admin.eggs.*'
  | 'admin.mounts.*'
  | 'admin.settings.*'

export interface PermissionCheck {
  hasPermission: boolean
  reason?: string
}

export interface UserPermissions {
  userId: string
  isAdmin: boolean
  serverPermissions: Map<string, Permission[]>
}

export class PermissionManager {
  private db = useDrizzle()

  // Permission hierarchy - higher level permissions include lower level ones
  private permissionHierarchy: Record<string, Permission[]> = {
    'admin.*': [
      'admin.servers.*', 'admin.users.*', 'admin.nodes.*', 
      'admin.locations.*', 'admin.nests.*', 'admin.eggs.*', 
      'admin.mounts.*', 'admin.settings.*'
    ],
    'admin.servers.*': [
      'server.view', 'server.console', 'server.power', 'server.command',
      'server.files.read', 'server.files.write', 'server.files.delete',
      'server.files.upload', 'server.files.download', 'server.files.compress',
      'server.backup.create', 'server.backup.restore', 'server.backup.delete',
      'server.backup.download', 'server.database.create', 'server.database.read',
      'server.database.update', 'server.database.delete', 'server.schedule.create',
      'server.schedule.read', 'server.schedule.update', 'server.schedule.delete',
      'server.settings.read', 'server.settings.update', 'server.users.read',
      'server.users.create', 'server.users.update', 'server.users.delete'
    ],
    'server.files.*': [
      'server.files.read', 'server.files.write', 'server.files.delete',
      'server.files.upload', 'server.files.download', 'server.files.compress'
    ],
    'server.backup.*': [
      'server.backup.create', 'server.backup.restore', 'server.backup.delete', 'server.backup.download'
    ],
    'server.database.*': [
      'server.database.create', 'server.database.read', 'server.database.update', 'server.database.delete'
    ],
    'server.schedule.*': [
      'server.schedule.create', 'server.schedule.read', 'server.schedule.update', 'server.schedule.delete'
    ],
    'server.users.*': [
      'server.users.read', 'server.users.create', 'server.users.update', 'server.users.delete'
    ]
  }

  // Default permission sets
  private defaultPermissionSets = {
    owner: [
      'server.view', 'server.console', 'server.power', 'server.command',
      'server.files.read', 'server.files.write', 'server.files.delete',
      'server.files.upload', 'server.files.download', 'server.files.compress',
      'server.backup.create', 'server.backup.restore', 'server.backup.delete',
      'server.backup.download', 'server.database.create', 'server.database.read',
      'server.database.update', 'server.database.delete', 'server.schedule.create',
      'server.schedule.read', 'server.schedule.update', 'server.schedule.delete',
      'server.settings.read', 'server.settings.update', 'server.users.read',
      'server.users.create', 'server.users.update', 'server.users.delete'
    ] as Permission[],
    
    moderator: [
      'server.view', 'server.console', 'server.power', 'server.command',
      'server.files.read', 'server.files.write', 'server.files.upload',
      'server.files.download', 'server.backup.create', 'server.backup.download',
      'server.database.read', 'server.schedule.read', 'server.settings.read'
    ] as Permission[],
    
    viewer: [
      'server.view', 'server.console', 'server.files.read', 'server.files.download',
      'server.backup.download', 'server.database.read', 'server.schedule.read',
      'server.settings.read'
    ] as Permission[]
  }

  private expandPermissions(permissions: Permission[]): Permission[] {
    const expanded = new Set<Permission>(permissions)
    
    for (const permission of permissions) {
      const hierarchyPerms = this.permissionHierarchy[permission]
      if (hierarchyPerms) {
        hierarchyPerms.forEach(p => expanded.add(p))
      }
    }
    
    return Array.from(expanded)
  }

  async getUserPermissions(userId: string): Promise<UserPermissions> {
    // Check if user is admin
    const user = await this.db
      .select()
      .from(tables.users)
      .where(eq(tables.users.id, userId))
      .get()

    if (!user) {
      throw new Error('User not found')
    }

    const isAdmin = user.rootAdmin

    // Get server-specific permissions
    const serverPermissions = new Map<string, Permission[]>()

    if (isAdmin) {
      // Admins have all permissions on all servers
      return {
        userId,
        isAdmin: true,
        serverPermissions,
      }
    }

    // Get servers where user is owner
    const ownedServers = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.ownerId, userId))
      .all()

    for (const server of ownedServers) {
      serverPermissions.set(server.id, this.defaultPermissionSets.owner)
    }

    // Get servers where user is subuser
    const subusers = await this.db
      .select()
      .from(tables.serverSubusers)
      .where(eq(tables.serverSubusers.userId, userId))
      .all()

    for (const subuser of subusers) {
      try {
        const permissions = JSON.parse(subuser.permissions) as Permission[]
        const expandedPermissions = this.expandPermissions(permissions)
        serverPermissions.set(subuser.serverId, expandedPermissions)
      } catch (error) {
        console.error(`Failed to parse permissions for subuser ${subuser.id}:`, error)
        // Default to viewer permissions if parsing fails
        serverPermissions.set(subuser.serverId, this.defaultPermissionSets.viewer)
      }
    }

    return {
      userId,
      isAdmin: false,
      serverPermissions,
    }
  }

  async checkPermission(
    userId: string, 
    permission: Permission, 
    serverId?: string
  ): Promise<PermissionCheck> {
    const userPermissions = await this.getUserPermissions(userId)

    // Admins have all permissions
    if (userPermissions.isAdmin) {
      return { hasPermission: true }
    }

    // Check admin permissions
    if (permission.startsWith('admin.')) {
      return { 
        hasPermission: false, 
        reason: 'Admin permissions required' 
      }
    }

    // Check server-specific permissions
    if (serverId) {
      const serverPerms = userPermissions.serverPermissions.get(serverId)
      if (!serverPerms) {
        return { 
          hasPermission: false, 
          reason: 'No access to this server' 
        }
      }

      const hasPermission = serverPerms.includes(permission)
      return {
        hasPermission,
        reason: hasPermission ? undefined : `Missing permission: ${permission}`
      }
    }

    // For non-server permissions, check if user has any admin role
    return { 
      hasPermission: false, 
      reason: 'Insufficient permissions' 
    }
  }

  async checkServerAccess(userId: string, serverId: string): Promise<PermissionCheck> {
    return this.checkPermission(userId, 'server.view', serverId)
  }

  async addServerSubuser(
    serverId: string, 
    userId: string, 
    permissions: Permission[],
    actorUserId: string
  ): Promise<void> {
    // Check if actor has permission to manage users
    const actorCheck = await this.checkPermission(actorUserId, 'server.users.create', serverId)
    if (!actorCheck.hasPermission) {
      throw new Error('Permission denied: Cannot manage server users')
    }

    // Check if user already has access
    const existingSubuser = await this.db
      .select()
      .from(tables.serverSubusers)
      .where(and(
        eq(tables.serverSubusers.serverId, serverId),
        eq(tables.serverSubusers.userId, userId)
      ))
      .get()

    if (existingSubuser) {
      throw new Error('User already has access to this server')
    }

    // Check if user is server owner
    const server = await this.db
      .select()
      .from(tables.servers)
      .where(eq(tables.servers.id, serverId))
      .get()

    if (server?.ownerId === userId) {
      throw new Error('User is already the server owner')
    }

    const now = new Date()
    await this.db.insert(tables.serverSubusers).values({
      id: `subuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      serverId,
      userId,
      permissions: JSON.stringify(permissions),
      createdAt: now,
      updatedAt: now,
    })
  }

  async updateServerSubuser(
    serverId: string,
    userId: string,
    permissions: Permission[],
    actorUserId: string
  ): Promise<void> {
    // Check if actor has permission to manage users
    const actorCheck = await this.checkPermission(actorUserId, 'server.users.update', serverId)
    if (!actorCheck.hasPermission) {
      throw new Error('Permission denied: Cannot manage server users')
    }

    const subuser = await this.db
      .select()
      .from(tables.serverSubusers)
      .where(and(
        eq(tables.serverSubusers.serverId, serverId),
        eq(tables.serverSubusers.userId, userId)
      ))
      .get()

    if (!subuser) {
      throw new Error('Subuser not found')
    }

    await this.db
      .update(tables.serverSubusers)
      .set({
        permissions: JSON.stringify(permissions),
        updatedAt: new Date(),
      })
      .where(eq(tables.serverSubusers.id, subuser.id))
      .run()
  }

  async removeServerSubuser(
    serverId: string,
    userId: string,
    actorUserId: string
  ): Promise<void> {
    // Check if actor has permission to manage users
    const actorCheck = await this.checkPermission(actorUserId, 'server.users.delete', serverId)
    if (!actorCheck.hasPermission) {
      throw new Error('Permission denied: Cannot manage server users')
    }

    const subuser = await this.db
      .select()
      .from(tables.serverSubusers)
      .where(and(
        eq(tables.serverSubusers.serverId, serverId),
        eq(tables.serverSubusers.userId, userId)
      ))
      .get()

    if (!subuser) {
      throw new Error('Subuser not found')
    }

    await this.db
      .delete(tables.serverSubusers)
      .where(eq(tables.serverSubusers.id, subuser.id))
      .run()
  }

  async getServerSubusers(serverId: string, actorUserId: string) {
    // Check if actor has permission to view users
    const actorCheck = await this.checkPermission(actorUserId, 'server.users.read', serverId)
    if (!actorCheck.hasPermission) {
      throw new Error('Permission denied: Cannot view server users')
    }

    const subusers = await this.db
      .select({
        id: tables.serverSubusers.id,
        userId: tables.serverSubusers.userId,
        permissions: tables.serverSubusers.permissions,
        createdAt: tables.serverSubusers.createdAt,
        updatedAt: tables.serverSubusers.updatedAt,
        userName: tables.users.username,
        userEmail: tables.users.email,
      })
      .from(tables.serverSubusers)
      .leftJoin(tables.users, eq(tables.serverSubusers.userId, tables.users.id))
      .where(eq(tables.serverSubusers.serverId, serverId))
      .all()

    return subusers.map(subuser => ({
      id: subuser.id,
      userId: subuser.userId,
      userName: subuser.userName,
      userEmail: subuser.userEmail,
      permissions: JSON.parse(subuser.permissions || '[]') as Permission[],
      createdAt: subuser.createdAt,
      updatedAt: subuser.updatedAt,
    }))
  }

  getDefaultPermissionSets() {
    return this.defaultPermissionSets
  }

  getAllPermissions(): Permission[] {
    return [
      'server.view', 'server.console', 'server.power', 'server.command',
      'server.files.read', 'server.files.write', 'server.files.delete',
      'server.files.upload', 'server.files.download', 'server.files.compress',
      'server.backup.create', 'server.backup.restore', 'server.backup.delete',
      'server.backup.download', 'server.database.create', 'server.database.read',
      'server.database.update', 'server.database.delete', 'server.schedule.create',
      'server.schedule.read', 'server.schedule.update', 'server.schedule.delete',
      'server.settings.read', 'server.settings.update', 'server.users.read',
      'server.users.create', 'server.users.update', 'server.users.delete',
      'admin.*', 'admin.servers.*', 'admin.users.*', 'admin.nodes.*',
      'admin.locations.*', 'admin.nests.*', 'admin.eggs.*', 'admin.mounts.*',
      'admin.settings.*'
    ]
  }
}

// Export singleton instance
export const permissionManager = new PermissionManager()
