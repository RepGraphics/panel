import { z } from 'zod';
import { getWingsClientForServer, WingsAuthError, WingsConnectionError } from '#server/utils/wings-client';
import { getServerWithAccess } from '#server/utils/server-helpers';
import { requireServerPermission } from '#server/utils/permission-middleware';
import {
  requireAccountUser,
  readValidatedBodyWithLimit,
  BODY_SIZE_LIMITS,
} from '#server/utils/security';
import { recordAuditEventFromRequest } from '#server/utils/audit';

const EULA_FILE_PATH = 'eula.txt';

const updateEulaSchema = z.object({
  accepted: z.boolean(),
});

function buildDefaultEulaContent(accepted: boolean): string {
  const value = accepted ? 'true' : 'false';
  return [
    '# By changing the setting below to TRUE you are indicating your agreement to our EULA.',
    '# https://aka.ms/MinecraftEULA',
    `eula=${value}`,
    '',
  ].join('\n');
}

function updateEulaContent(existingContent: string | null, accepted: boolean): string {
  const value = accepted ? 'true' : 'false';

  if (!existingContent || existingContent.trim().length === 0) {
    return buildDefaultEulaContent(accepted);
  }

  const newline = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const lines = existingContent.split(/\r?\n/);
  let replaced = false;

  const updatedLines = lines.map((line) => {
    if (/^\s*eula\s*=/i.test(line)) {
      replaced = true;
      return `eula=${value}`;
    }

    return line;
  });

  if (!replaced) {
    updatedLines.push(`eula=${value}`);
  }

  let nextContent = updatedLines.join(newline);
  if (!nextContent.endsWith(newline)) {
    nextContent += newline;
  }

  return nextContent;
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
    requiredPermissions: ['server.files.write'],
    allowOwner: true,
    allowAdmin: true,
  });

  const body = await readValidatedBodyWithLimit(event, updateEulaSchema, BODY_SIZE_LIMITS.SMALL);

  try {
    const { client } = await getWingsClientForServer(server.uuid);

    let existingContent: string | null = null;
    try {
      existingContent = await client.getFileContents(server.uuid, EULA_FILE_PATH);
    } catch (error) {
      if (error instanceof WingsConnectionError) {
        const message = error.message.toLowerCase();
        const isMissingFile = message.includes('404') || message.includes('not found');

        if (!isMissingFile) {
          throw error;
        }
      } else {
        throw error;
      }
    }

    const nextContent = updateEulaContent(existingContent, body.accepted);
    await client.writeFileContents(server.uuid, EULA_FILE_PATH, nextContent);

    await recordAuditEventFromRequest(event, {
      actor: accountContext.user.id,
      actorType: 'user',
      action: 'server.minecraft.eula.updated',
      targetType: 'server',
      targetId: server.id,
      metadata: {
        file: EULA_FILE_PATH,
        accepted: body.accepted,
      },
    });

    return {
      data: {
        filePath: EULA_FILE_PATH,
        accepted: body.accepted,
        requiresAcceptance: !body.accepted,
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
      throw createError({
        status: 503,
        statusText: 'Wings daemon unavailable',
      });
    }

    throw createError({
      status: 500,
      statusText: 'Failed to update Minecraft EULA',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});
