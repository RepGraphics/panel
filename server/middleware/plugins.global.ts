import { emitPluginHook } from '#server/utils/plugins/runtime';

export default defineEventHandler(async (event) => {
  await emitPluginHook('request:before', {
    event,
  });

  event.node.res.once('finish', () => {
    void emitPluginHook('request:after', {
      event,
      statusCode: event.node.res.statusCode,
    });
  });
});
