import { eq } from 'drizzle-orm';
import { getWingsClientForServer, WingsAuthError, WingsConnectionError } from '#server/utils/wings-client';
import { getServerWithAccess } from '#server/utils/server-helpers';
import { requireServerPermission } from '#server/utils/permission-middleware';
import { requireAccountUser } from '#server/utils/security';
import { useDrizzle, tables } from '#server/utils/drizzle';

const EULA_FILE_PATH = 'eula.txt';
const MINECRAFT_HINT_REGEX =
  /(minecraft|paper|spigot|purpur|bukkit|forge|fabric|neoforge|bedrock|vanilla)/i;

function parseEulaAcceptance(content: string): boolean | null {
  const match = content.match(/^\s*eula\s*=\s*(true|false)\s*$/im);
  if (!match) {
    return null;
  }

  return match[1]?.toLowerCase() === 'true';
}

function isLikelyMinecraftServer(parts: Array<string | null | undefined>): boolean {
  const haystack = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');

  if (!haystack) {
    return false;
  }

  return MINECRAFT_HINT_REGEX.test(haystack);
}

export default defineEventHandler(async (event) => {
  const accountContext = await requireAccountUser(event);
  const serverIdentifier = getRouterParam(event, 'server');

  if (!serverIdentifier) {
    throw createError({
      status: 400,
      message: 'Server identifier is required',
    });
  }

  const { server } = await getServerWithAccess(serverIdentifier, accountContext.session);

  await requireServerPermission(event, {
    serverId: server.id,
    requiredPermissions: ['server.files.read'],
    allowOwner: true,
    allowAdmin: true,
  });

  const db = useDrizzle();
  let eggName: string | null = null;
  let eggDescription: string | null = null;
  let eggStartup: string | null = null;

  if (server.eggId) {
    const [egg] = await db
      .select({
        name: tables.eggs.name,
        description: tables.eggs.description,
        startup: tables.eggs.startup,
      })
      .from(tables.eggs)
      .where(eq(tables.eggs.id, server.eggId))
      .limit(1);

    eggName = egg?.name ?? null;
    eggDescription = egg?.description ?? null;
    eggStartup = egg?.startup ?? null;
  }

  const likelyMinecraft = isLikelyMinecraftServer([
    server.name,
    server.startup,
    server.image,
    server.dockerImage,
    eggName,
    eggDescription,
    eggStartup,
  ]);

  try {
    const { client } = await getWingsClientForServer(server.uuid);
    const content = await client.getFileContents(server.uuid, EULA_FILE_PATH);
    const accepted = parseEulaAcceptance(content);
    const requiresAcceptance = accepted === false;

    return {
      data: {
        supported: likelyMinecraft || accepted !== null,
        likelyMinecraft,
        fileExists: true,
        accepted,
        requiresAcceptance,
        filePath: EULA_FILE_PATH,
      },
    };
  } catch (error) {
    if (error instanceof WingsAuthError) {
      throw createError({
        status: 403,
        statusText: 'Wings authentication failed',
      });
    }

    if (error instanceof WingsConnectionError) {
      const message = error.message.toLowerCase();
      const isMissingFile = message.includes('404') || message.includes('not found');

      if (isMissingFile) {
        return {
          data: {
            supported: likelyMinecraft,
            likelyMinecraft,
            fileExists: false,
            accepted: null,
            requiresAcceptance: false,
            filePath: EULA_FILE_PATH,
          },
        };
      }

      throw createError({
        status: 503,
        statusText: 'Wings daemon unavailable',
      });
    }

    throw createError({
      status: 500,
      statusText: 'Failed to determine Minecraft EULA status',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});
