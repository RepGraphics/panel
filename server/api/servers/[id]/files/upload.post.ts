import type { H3Event } from 'h3';
import { remoteUploadFiles } from '#server/utils/wings/registry';
import { requireAccountUser } from '#server/utils/security';
import { getServerWithAccess } from '#server/utils/server-helpers';
import { requireServerPermission } from '#server/utils/permission-middleware';
import { recordServerActivity } from '#server/utils/server-activity';

const MAX_UPLOAD_FILE_COUNT = 25;
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;

function assertMultipartSizeWithinLimit(event: H3Event): void {
  const contentLength = getRequestHeader(event, 'content-length');
  if (!contentLength) {
    return;
  }

  const parsedLength = Number.parseInt(contentLength, 10);
  if (Number.isNaN(parsedLength)) {
    return;
  }

  if (parsedLength > MAX_UPLOAD_TOTAL_BYTES) {
    throw createError({
      status: 413,
      statusText: 'Payload Too Large',
      message: `Upload payload exceeds ${Math.floor(MAX_UPLOAD_TOTAL_BYTES / (1024 * 1024))}MB.`,
    });
  }
}

export default defineEventHandler(async (event) => {
  const identifier = getRouterParam(event, 'id');
  if (!identifier) {
    throw createError({
      status: 400,
      statusText: 'Bad Request',
      message: 'Missing server identifier',
    });
  }

  const { user, session } = await requireAccountUser(event);
  const { server } = await getServerWithAccess(identifier, session);

  await requireServerPermission(event, {
    serverId: server.id,
    requiredPermissions: ['server.files.upload'],
  });

  assertMultipartSizeWithinLimit(event);
  const formData = await readMultipartFormData(event);

  if (!formData) {
    throw createError({
      status: 400,
      statusText: 'Bad Request',
      message: 'No form data provided',
    });
  }

  const directoryField = formData.find((field) => field.name === 'directory' && field.data);
  const directory = directoryField?.data?.toString().trim();
  const files = formData.filter((field) => field.name === 'files' && field.type === 'file');

  if (!directory) {
    throw createError({
      status: 422,
      statusText: 'Unprocessable Entity',
      message: 'Target directory is required',
    });
  }

  if (files.length === 0) {
    throw createError({
      status: 422,
      statusText: 'Unprocessable Entity',
      message: 'At least one file is required for upload',
    });
  }

  if (files.length > MAX_UPLOAD_FILE_COUNT) {
    throw createError({
      status: 422,
      statusText: 'Unprocessable Entity',
      message: `A maximum of ${MAX_UPLOAD_FILE_COUNT} files can be uploaded in one request.`,
    });
  }

  const totalUploadBytes = files.reduce((total, file) => total + (file.data?.length ?? 0), 0);
  if (totalUploadBytes > MAX_UPLOAD_TOTAL_BYTES) {
    throw createError({
      status: 413,
      statusText: 'Payload Too Large',
      message: `Upload payload exceeds ${Math.floor(MAX_UPLOAD_TOTAL_BYTES / (1024 * 1024))}MB.`,
    });
  }

  try {
    if (!server.nodeId) {
      throw createError({ status: 500, statusText: 'Server has no assigned node' });
    }

    await remoteUploadFiles(
      server.uuid,
      directory,
      files.map((file) => ({
        name: file.filename ?? 'upload.bin',
        data: file.data,
        mime: file.type,
      })),
      server.nodeId,
    );

    await recordServerActivity({
      event,
      actorId: user.id,
      action: 'server.files.upload',
      server: { id: server.id, uuid: server.uuid },
      metadata: {
        directory,
        fileCount: files.length,
      },
    });

    return {
      data: {
        success: true,
        uploaded: files.length,
      },
    };
  } catch (error) {
    throw createError({
      status: 500,
      statusText: 'Wings API Error',
      message: error instanceof Error ? error.message : 'Failed to upload files',
      cause: error,
    });
  }
});
