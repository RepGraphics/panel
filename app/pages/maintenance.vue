<script setup lang="ts">
definePageMeta({
  layout: false,
});

const { t } = useI18n();

const { data: maintenanceStatus } = await useFetch('/api/maintenance-status', {
  key: 'maintenance-page-status',
  default: () =>
    ({
      maintenanceMode: false,
      maintenanceMessage: '',
    }) as { maintenanceMode: boolean; maintenanceMessage: string },
});

const maintenanceMessage = computed(
  () =>
    maintenanceStatus.value?.maintenanceMessage?.trim() || t('layout.defaultMaintenanceMessage'),
);
</script>

<template>
  <div class="min-h-screen bg-muted/20">
    <UContainer class="min-h-screen flex items-center justify-center py-16">
      <UCard class="w-full max-w-xl border-default/80 shadow-sm">
        <div class="flex flex-col items-center gap-4 text-center">
          <UIcon name="i-lucide-construction" class="size-16 text-warning" />
          <div class="space-y-2">
            <h1 class="text-2xl font-semibold">{{ t('layout.underMaintenance') }}</h1>
            <p class="text-sm text-muted-foreground whitespace-pre-wrap">
              {{ maintenanceMessage }}
            </p>
          </div>
        </div>
      </UCard>
    </UContainer>
  </div>
</template>
