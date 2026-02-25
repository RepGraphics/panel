<script setup lang="ts">
import type { PluginClientContributions, PluginUiSlotContribution } from '#shared/types/plugins';

const props = withDefaults(
  defineProps<{
    name: string;
    context?: Record<string, unknown> | null;
    serverId?: string | null;
    contributions?: PluginClientContributions | null;
  }>(),
  {
    context: null,
    serverId: null,
    contributions: null,
  },
);

const fetchedContributions =
  props.contributions === null
    ? await usePluginContributions(
        props.serverId ? { serverId: props.serverId } : undefined,
      )
    : null;

const contributions = computed<PluginClientContributions>(() => {
  if (props.contributions) {
    return props.contributions;
  }

  return (
    fetchedContributions?.data.value ?? {
      adminNavigation: [],
      dashboardNavigation: [],
      serverNavigation: [],
      uiSlots: [],
    }
  );
});

const slotContributions = computed<PluginUiSlotContribution[]>(() => {
  const entries = contributions.value.uiSlots;
  return entries
    .filter((entry) => entry.slot === props.name)
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY));
});
</script>

<template>
  <template
    v-for="(entry, index) in slotContributions"
    :key="`${entry.pluginId}:${entry.component}:${index}`"
  >
    <component :is="entry.component" v-bind="{ ...(entry.props ?? {}), context }" />
  </template>
</template>
