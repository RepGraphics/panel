import { emitPluginHook, initializePluginRuntime } from '#server/utils/plugins/runtime';

export default defineNitroPlugin(async (nitroApp) => {
  const summary = await initializePluginRuntime(nitroApp);

  if (summary.discoveryErrors.length > 0) {
    for (const discoveryError of summary.discoveryErrors) {
      console.warn(
        `[plugins] ${discoveryError.message}`,
        discoveryError.manifestPath ? `(${discoveryError.manifestPath})` : '',
      );
    }
  }

  const loadedCount = summary.plugins.filter((plugin) => plugin.enabled && plugin.loaded).length;
  const failedCount = summary.plugins.filter((plugin) => plugin.enabled && !plugin.loaded).length;
  console.info(`[plugins] Initialized ${loadedCount} plugin(s), ${failedCount} failed.`);

  await emitPluginHook('panel:ready', {
    loaded: loadedCount,
    failed: failedCount,
  });
});
