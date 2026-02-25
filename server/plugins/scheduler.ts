function isNuxtBuildProcess(): boolean {
  const args = process.argv.map((arg) => arg.toLowerCase());
  const isBuildCommand = args.includes('build');
  const runsNuxtCli = args.some((arg) => arg.includes('nuxt') || arg.includes('nuxi'));

  return isBuildCommand && runsNuxtCli;
}

export default defineNitroPlugin(async () => {
  if (import.meta.prerender || isNuxtBuildProcess()) {
    return;
  }

  const { taskScheduler } = await import('#server/utils/task-scheduler');
  taskScheduler.startScheduler();
});
