import { z } from 'zod';
import type { H3Event } from 'h3';
import { requireAdmin, readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '#server/utils/security';
import { recordAuditEventFromRequest } from '#server/utils/audit';
import { requireAdminApiKeyPermission } from '#server/utils/admin-api-permissions';
import { ADMIN_ACL_PERMISSIONS, ADMIN_ACL_RESOURCES } from '#server/utils/admin-acl';
import {
  installPluginFromArchiveBuffer,
  installPluginFromLocalSource,
  PluginInstallError,
} from '#server/utils/plugins/installer';
import { applyPluginLayerRefresh } from '#server/utils/plugins/layer-refresh';
import { reloadPluginRuntime } from '#server/utils/plugins/runtime';

const MAX_ARCHIVE_SIZE_BYTES = 50 * 1024 * 1024;

const pathInstallSchema = z.object({
  sourcePath: z.string().trim().min(1),
  manifestPath: z.string().trim().min(1).optional(),
  force: z.boolean().optional().default(false),
  autoRestart: z.boolean().optional().default(true),
});

function parseBooleanLike(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getMultipartFieldValue(
  formData: Awaited<ReturnType<typeof readMultipartFormData>>,
  name: string,
): string | undefined {
  if (!formData) return undefined;

  const field = formData.find((entry) => entry.name === name);
  if (!field?.data) return undefined;

  const value = field.data.toString('utf8').trim();
  return value.length > 0 ? value : undefined;
}

function assertMultipartSizeWithinLimit(event: H3Event): void {
  const contentLength = getRequestHeader(event, 'content-length');
  if (!contentLength) {
    return;
  }

  const parsedLength = Number.parseInt(contentLength, 10);
  if (Number.isNaN(parsedLength)) {
    return;
  }

  if (parsedLength > MAX_ARCHIVE_SIZE_BYTES) {
    throw createError({
      status: 413,
      statusText: 'Payload Too Large',
      message: `Archive payload exceeds ${Math.floor(MAX_ARCHIVE_SIZE_BYTES / (1024 * 1024))}MB.`,
    });
  }
}

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event);

  await requireAdminApiKeyPermission(
    event,
    ADMIN_ACL_RESOURCES.PANEL_SETTINGS,
    ADMIN_ACL_PERMISSIONS.WRITE,
  );

  const contentType = getRequestHeader(event, 'content-type') ?? '';
  const isMultipart = contentType.includes('multipart/form-data');

  try {
    let autoRestart = true;

    const installResult = isMultipart
      ? await (async () => {
          assertMultipartSizeWithinLimit(event);

          const formData = await readMultipartFormData(event);
          if (!formData) {
            throw new PluginInstallError(400, 'No multipart form data received.');
          }

          const archive = formData.find((entry) => entry.name === 'archive' && entry.data);
          if (!archive?.data) {
            throw new PluginInstallError(422, 'Archive file is required.');
          }

          if (archive.data.length > MAX_ARCHIVE_SIZE_BYTES) {
            throw new PluginInstallError(
              413,
              `Archive payload exceeds ${Math.floor(MAX_ARCHIVE_SIZE_BYTES / (1024 * 1024))}MB.`,
            );
          }

          const autoRestartField = getMultipartFieldValue(formData, 'autoRestart');
          autoRestart = autoRestartField ? parseBooleanLike(autoRestartField) : true;

          return await installPluginFromArchiveBuffer(archive.data, {
            archiveFilename: archive.filename,
            force: parseBooleanLike(getMultipartFieldValue(formData, 'force')),
            manifestPath: getMultipartFieldValue(formData, 'manifestPath'),
          });
        })()
      : await (async () => {
          const body = await readValidatedBodyWithLimit(
            event,
            pathInstallSchema,
            BODY_SIZE_LIMITS.SMALL,
          );

          autoRestart = body.autoRestart;

          return await installPluginFromLocalSource(body.sourcePath, {
            force: body.force,
            manifestPath: body.manifestPath,
          });
        })();

    const runtimeSummary = await reloadPluginRuntime();
    const runtimePlugin = runtimeSummary.plugins.find((plugin) => plugin.id === installResult.id);
    const restart = await applyPluginLayerRefresh({
      event,
      restartRequired: installResult.restartRequired,
      autoRestart,
    });

    await recordAuditEventFromRequest(event, {
      actor: session.user.email || session.user.id,
      actorType: 'user',
      action: 'admin.plugins.installed',
      targetType: 'settings',
      metadata: {
        pluginId: installResult.id,
        pluginVersion: installResult.version,
        sourceType: isMultipart ? 'upload' : 'path',
        replaced: installResult.replaced,
        restartRequired: installResult.restartRequired,
        restartMode: restart.mode,
        restartAutomated: restart.automated,
      },
    });

    return {
      data: {
        ...installResult,
        message: restart.message,
        restartMode: restart.mode,
        restartAutomated: restart.automated,
        runtime: runtimePlugin
          ? {
              loaded: runtimePlugin.loaded,
              errors: runtimePlugin.errors,
            }
          : null,
        summary: {
          initialized: runtimeSummary.initialized,
          pluginCount: runtimeSummary.plugins.length,
          discoveryErrorCount: runtimeSummary.discoveryErrors.length,
        },
      },
    };
  } catch (error) {
    if (error instanceof PluginInstallError) {
      throw createError({
        status: error.statusCode,
        statusText: error.statusCode >= 500 ? 'Plugin install failed' : 'Bad Request',
        message: error.message,
      });
    }

    throw error;
  }
});
