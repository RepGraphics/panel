import type { H3Event } from 'h3'
import { createError } from 'h3'
import { getServerSession } from '#auth'
import { permissionManager, type Permission } from './permission-manager'
import { resolveSessionUser } from './auth/sessionUser'

export interface PermissionMiddlewareOptions {
  requiredPermissions: Permission[]
  serverId?: string
  allowOwner?: boolean
  allowAdmin?: boolean
}

export interface PermissionContext {
  userId: string
  isAdmin: boolean
  isOwner: boolean
  hasPermissions: boolean
  missingPermissions: Permission[]
}

/**
 * Middleware to check user permissions for server operations
 */
export async function requireServerPermission(
  event: H3Event,
  options: PermissionMiddlewareOptions
): Promise<PermissionContext> {
  const session = await getServerSession(event)
  const user = resolveSessionUser(session)

  if (!user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Authentication required',
    })
  }

  if (!options.serverId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Server ID is required for permission check',
    })
  }

  const userPermissions = await permissionManager.getUserPermissions(user.id)
  const isAdmin = userPermissions.isAdmin
  const serverPerms = userPermissions.serverPermissions.get(options.serverId) || []

  // Check if user is server owner
  const isOwner = serverPerms.length > 0 && serverPerms.includes('server.view')

  // Admin bypass
  if (isAdmin && (options.allowAdmin !== false)) {
    return {
      userId: user.id,
      isAdmin: true,
      isOwner: false,
      hasPermissions: true,
      missingPermissions: [],
    }
  }

  // Owner bypass
  if (isOwner && (options.allowOwner !== false)) {
    return {
      userId: user.id,
      isAdmin: false,
      isOwner: true,
      hasPermissions: true,
      missingPermissions: [],
    }
  }

  // Check specific permissions
  const missingPermissions: Permission[] = []
  for (const permission of options.requiredPermissions) {
    if (!serverPerms.includes(permission)) {
      missingPermissions.push(permission)
    }
  }

  const hasPermissions = missingPermissions.length === 0

  if (!hasPermissions) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `Missing required permissions: ${missingPermissions.join(', ')}`,
      data: {
        missingPermissions,
        requiredPermissions: options.requiredPermissions,
      },
    })
  }

  return {
    userId: user.id,
    isAdmin: false,
    isOwner: false,
    hasPermissions: true,
    missingPermissions: [],
  }
}

/**
 * Helper to check a single permission
 */
export async function requirePermission(
  event: H3Event,
  permission: Permission,
  serverId: string
): Promise<PermissionContext> {
  return requireServerPermission(event, {
    requiredPermissions: [permission],
    serverId,
  })
}

/**
 * Helper to check multiple permissions (all required)
 */
export async function requireAllPermissions(
  event: H3Event,
  permissions: Permission[],
  serverId: string
): Promise<PermissionContext> {
  return requireServerPermission(event, {
    requiredPermissions: permissions,
    serverId,
  })
}

/**
 * Helper to check if user has any of the specified permissions
 */
export async function requireAnyPermission(
  event: H3Event,
  permissions: Permission[],
  serverId: string
): Promise<PermissionContext> {
  const session = await getServerSession(event)
  const user = resolveSessionUser(session)

  if (!user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Authentication required',
    })
  }

  const userPermissions = await permissionManager.getUserPermissions(user.id)
  const isAdmin = userPermissions.isAdmin
  const serverPerms = userPermissions.serverPermissions.get(serverId) || []

  // Check if user is server owner
  const isOwner = serverPerms.length > 0 && serverPerms.includes('server.view')

  // Admin or owner bypass
  if (isAdmin || isOwner) {
    return {
      userId: user.id,
      isAdmin,
      isOwner,
      hasPermissions: true,
      missingPermissions: [],
    }
  }

  // Check if user has any of the required permissions
  const hasAnyPermission = permissions.some(permission => 
    serverPerms.includes(permission)
  )

  if (!hasAnyPermission) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `Missing any of required permissions: ${permissions.join(', ')}`,
      data: {
        requiredPermissions: permissions,
      },
    })
  }

  return {
    userId: user.id,
    isAdmin: false,
    isOwner: false,
    hasPermissions: true,
    missingPermissions: [],
  }
}

/**
 * Helper to check admin permissions
 */
export async function requireAdminPermission(event: H3Event): Promise<PermissionContext> {
  const session = await getServerSession(event)
  const user = resolveSessionUser(session)

  if (!user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Authentication required',
    })
  }

  const userPermissions = await permissionManager.getUserPermissions(user.id)
  
  if (!userPermissions.isAdmin) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Administrator privileges required',
    })
  }

  return {
    userId: user.id,
    isAdmin: true,
    isOwner: false,
    hasPermissions: true,
    missingPermissions: [],
  }
}
