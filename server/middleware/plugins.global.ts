import { emitPluginHook, hasPluginHook } from '#server/utils/plugins/runtime';

export default defineEventHandler(async (event) => {
  if (hasPluginHook('request:before')) {
    await emitPluginHook('request:before', {
      event,
    });
  }

  if (hasPluginHook('request:after')) {
    event.node.res.once('finish', () => {
      void emitPluginHook('request:after', {
        event,
        statusCode: event.node.res.statusCode,
      });
    });
  }
});
