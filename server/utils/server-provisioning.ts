import { useDrizzle, tables, eq, inArray } from './drizzle'
import { getWingsClient } from './wings-client'
import type { WingsClient, WingsNode } from './wings-client'
import type { WingsServerConfiguration } from '#shared/types/wings-config'
import type { ServerProvisioningConfig } from '#shared/types/server-provisioning'

interface ServerProvisioningContext {
  wingsNode: WingsNode
  server: typeof tables.servers.$inferSelect
  limits: typeof tables.serverLimits.$inferSelect
  egg: typeof tables.eggs.$inferSelect
  allocation: typeof tables.serverAllocations.$inferSelect
  additionalAllocations: typeof tables.serverAllocations.$inferSelect[]
  eggVariables: typeof tables.eggVariables.$inferSelect[]
  mounts: typeof tables.mounts.$inferSelect[]
}

function buildEnvironmentVariables(
  context: ServerProvisioningContext,
  overrides?: Record<string, string>
): Record<string, string> {
  const environment: Record<string, string> = {}

  for (const eggVar of context.eggVariables) {
    const envKey = eggVar.envVariable
    const userValue = overrides?.[envKey]
    const defaultValue = eggVar.defaultValue

    if (userValue !== undefined) {
      environment[envKey] = String(userValue)
    } else if (defaultValue) {
      environment[envKey] = defaultValue
    }
  }

  environment.SERVER_MEMORY = String(context.limits.memory ?? 512)
  environment.SERVER_IP = context.allocation.ip
  environment.SERVER_PORT = String(context.allocation.port)

  return environment
}

function buildAllocationsConfig(
  context: ServerProvisioningContext
): WingsServerConfiguration['allocations'] {
  const mappings: Record<string, number[]> = {}

  for (const allocation of context.additionalAllocations) {
    const allocationIp = allocation.ip
    if (!allocationIp) {
      continue
    }

    const ports = (mappings[allocationIp] ??= [])
    ports.push(allocation.port)
  }

  return {
    force_outgoing_ip: false,
    default: {
      ip: context.allocation.ip ?? '0.0.0.0',
      port: context.allocation.port,
    },
    mappings,
  }
}

function buildMountsConfig(
  context: ServerProvisioningContext
): WingsServerConfiguration['mounts'] {
  return context.mounts.map(mount => ({
    source: mount.source,
    target: mount.target,
    read_only: mount.readOnly ?? false,
  }))
}

async function buildProvisioningContext(
  config: ServerProvisioningConfig
): Promise<ServerProvisioningContext> {
  const db = useDrizzle()

  const server = await db
    .select()
    .from(tables.servers)
    .where(eq(tables.servers.id, config.serverId))
    .get()

  if (!server) {
    throw new Error('Server not found')
  }

  const limits = await db
    .select()
    .from(tables.serverLimits)
    .where(eq(tables.serverLimits.serverId, config.serverId))
    .get()

  if (!limits) {
    throw new Error('Server limits not found')
  }

  const egg = await db
    .select()
    .from(tables.eggs)
    .where(eq(tables.eggs.id, config.eggId))
    .get()

  if (!egg) {
    throw new Error('Egg not found')
  }

  const allocation = await db
    .select()
    .from(tables.serverAllocations)
    .where(eq(tables.serverAllocations.id, config.allocationId))
    .get()

  if (!allocation) {
    throw new Error('Primary allocation not found')
  }

  const additionalAllocations = config.additionalAllocationIds?.length
    ? await db
        .select()
        .from(tables.serverAllocations)
        .where(inArray(tables.serverAllocations.id, config.additionalAllocationIds))
        .all()
    : []

  const eggVariables = await db
    .select()
    .from(tables.eggVariables)
    .where(eq(tables.eggVariables.eggId, config.eggId))
    .all()

  const mounts = config.mountIds?.length
    ? await db
        .select()
        .from(tables.mounts)
        .where(inArray(tables.mounts.id, config.mountIds))
        .all()
    : []

  const node = await db
    .select()
    .from(tables.wingsNodes)
    .where(eq(tables.wingsNodes.id, config.nodeId))
    .get()

  if (!node) {
    throw new Error('Node not found')
  }

  const wingsNode: WingsNode = {
    id: node.id,
    fqdn: node.fqdn,
    scheme: node.scheme as 'http' | 'https',
    daemonListen: node.daemonListen,
    daemonSftp: node.daemonSftp,
    daemonBase: node.daemonBase,
    tokenId: node.tokenIdentifier,
    token: node.tokenSecret,
  }

  return {
    wingsNode,
    server,
    limits,
    egg,
    allocation,
    additionalAllocations,
    eggVariables,
    mounts,
  }
}

export async function waitForServerInstall(client: WingsClient, serverUuid: string): Promise<void> {
  const maxRetries = 60
  const delayMs = 5000

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const details = await client.getServerDetails(serverUuid)

    if (details.state === 'running' || details.state === 'offline') {
      return
    }

    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  throw new Error('Server install timed out while waiting for Wings')
}

export async function buildWingsServerConfig(
  config: ServerProvisioningConfig
): Promise<{ context: ServerProvisioningContext; payload: WingsServerConfiguration }> {
  const context = await buildProvisioningContext(config)

  const environment = buildEnvironmentVariables(context, config.environment)
  const allocations = buildAllocationsConfig(context)
  const mounts = buildMountsConfig(context)

  const wingsConfig: WingsServerConfiguration = {
    uuid: config.serverUuid,
    meta: {
      name: context.server.name,
      description: context.server.description || '',
    },
    suspended: Boolean(context.server.suspended),
    invocation: context.egg.startup || '',
    skip_egg_scripts: Boolean(context.server.skipScripts),
    environment,
    labels: {},
    allocations,
    build: {
      memory_limit: context.limits.memory ?? 512,
      swap: context.limits.swap ?? 0,
      io_weight: context.limits.io ?? 500,
      cpu_limit: context.limits.cpu ?? 100,
      threads: context.limits.threads || '',
      disk_space: context.limits.disk ?? 1024,
      oom_disabled: Boolean(context.limits.oomDisabled ?? true),
    },
    feature_limits: {
      databases: context.server.databaseLimit ?? 0,
      backups: context.server.backupLimit ?? 0,
      allocations: context.server.allocationLimit ?? 0,
    },
    crash_detection_enabled: true,
    mounts,
    egg: {
      id: context.egg.id,
      file_denylist: [],
    },
    container: {
      image: config.dockerImageOverride || context.server.dockerImage || context.egg.dockerImage || 'ghcr.io/pterodactyl/yolks:latest',
      registry: config.dockerCredentials?.registry,
      username: config.dockerCredentials?.username,
      password: config.dockerCredentials?.password,
      image_pull_policy: config.dockerCredentials?.imagePullPolicy,
    },
  }

  return { context, payload: wingsConfig }
}

export async function provisionServerOnWings(
  config: ServerProvisioningConfig
): Promise<void> {
  const db = useDrizzle()

  const { context, payload } = await buildWingsServerConfig(config)

  const client = getWingsClient(context.wingsNode)

  const now = new Date()

  await db
    .update(tables.servers)
    .set({
      status: 'installing',
      installedAt: null,
      updatedAt: now,
    })
    .where(eq(tables.servers.id, config.serverId))
    .run()

  try {
    await client.createServer(config.serverUuid, payload as unknown as Record<string, unknown>)

    await waitForServerInstall(client, config.serverUuid)

    await db
      .update(tables.servers)
      .set({
        status: 'installed',
        installedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tables.servers.id, config.serverId))
      .run()
  } catch (error) {
    await db
      .update(tables.servers)
      .set({
        status: 'install_failed',
        updatedAt: new Date(),
      })
      .where(eq(tables.servers.id, config.serverId))
      .run()

    try {
      await client.deleteServer(config.serverUuid)
    } catch (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      if (!cleanupMessage.includes('404')) {
        console.warn('Failed to clean up failed Wings server provisioning:', cleanupMessage)
      }
    }

    throw error
  }
}

export async function triggerServerInstallation(serverUuid: string): Promise<void> {
  const db = useDrizzle()

  const server = await db
    .select()
    .from(tables.servers)
    .where(eq(tables.servers.uuid, serverUuid))
    .get()

  if (!server) {
    throw new Error('Server not found')
  }

  const node = await db
    .select()
    .from(tables.wingsNodes)
    .where(eq(tables.wingsNodes.id, server.nodeId!))
    .get()

  if (!node) {
    throw new Error('Node not found')
  }

  const wingsNode: WingsNode = {
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

  await client.reinstallServer(serverUuid)
}

export async function checkInstallationStatus(serverUuid: string): Promise<{
  status: string
  installing: boolean
}> {
  const db = useDrizzle()

  const server = await db
    .select()
    .from(tables.servers)
    .where(eq(tables.servers.uuid, serverUuid))
    .get()

  if (!server) {
    throw new Error('Server not found')
  }

  const node = await db
    .select()
    .from(tables.wingsNodes)
    .where(eq(tables.wingsNodes.id, server.nodeId!))
    .get()

  if (!node) {
    throw new Error('Node not found')
  }

  const wingsNode: WingsNode = {
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

  const details = await client.getServerDetails(serverUuid)

  const installing = server.status === 'installing'

  return {
    status: details.state,
    installing,
  }
}
