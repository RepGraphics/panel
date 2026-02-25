import { type H3Event } from 'h3';
import { recordAuditEventFromRequest } from '#server/utils/audit';
import { findServerByIdentifier } from '#server/utils/serversStore';
import { readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '#server/utils/security';
import { getNodeIdFromAuth } from '#server/utils/wings/auth';
import type { ActivityAction } from '#shared/types/audit';
import { remoteActivityBatchSchema } from '#shared/schema/wings';

export default defineEventHandler(async (event: H3Event) => {
  const nodeId = await getNodeIdFromAuth(event);

  const { data: activities } = await readValidatedBodyWithLimit(
    event,
    remoteActivityBatchSchema,
    BODY_SIZE_LIMITS.MEDIUM,
  );

  const insertedCount = activities.length;
  let successCount = 0;

  const serverCache = new Map<string, Awaited<ReturnType<typeof findServerByIdentifier>> | null>();

  for (const activity of activities) {
    try {
      if (!activity.event || !activity.timestamp) {
        console.warn('Skipping invalid activity log:', activity);
        continue;
      }

      let resolvedServer = null;
      const serverKey = activity.server;

      if (serverKey) {
        if (!serverCache.has(serverKey)) {
          const serverRecord = await findServerByIdentifier(serverKey);
          serverCache.set(serverKey, serverRecord);
        }
        resolvedServer = serverCache.get(serverKey) ?? null;

        if (resolvedServer && resolvedServer.nodeId !== nodeId) {
          console.warn(
            `[remote.activity] Ignoring activity for server ${serverKey} from unauthorized node ${nodeId}.`,
          );
          continue;
        }
      }

      await recordAuditEventFromRequest(event, {
        actor: activity.user || 'system',
        actorType: 'daemon',
        action: activity.event as ActivityAction,
        targetType: 'server',
        targetId: resolvedServer?.id ?? activity.server ?? null,
        metadata: {
          ...activity.metadata,
          serverUuid: resolvedServer?.uuid ?? activity.server ?? undefined,
          serverIdentifier: resolvedServer?.identifier ?? undefined,
          ip: activity.ip,
          wings_timestamp: activity.timestamp,
          source: 'wings',
          node_id: nodeId,
        },
      });

      successCount++;
    } catch (error) {
      console.error('Failed to insert activity log:', error, activity);
    }
  }

  return {
    data: {
      success: true,
      received: insertedCount,
      processed: successCount,
      failed: insertedCount - successCount,
    },
  };
});
