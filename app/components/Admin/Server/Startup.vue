<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Server } from '#shared/types/server'
import type { StartupResponse } from '#shared/types/api-responses'
import type {
  StartupForm,
  EnvironmentEntry,
  EnvironmentInputValue,
} from '#shared/types/server-startup'

const props = defineProps<{
  server: Server
}>()

const toast = useToast()
const isSubmitting = ref(false)

const {
  data: startupData,
  pending: startupPending,
  refresh,
  error: startupError,
} = await useAsyncData<StartupResponse | null>(
  `server-startup-${props.server.id}`,
  async () => {
    try {
      return await $fetch<StartupResponse>(`/api/admin/servers/${props.server.id}/startup`)
    }
    catch (error) {
      console.error('Failed to load startup configuration', error)
      return null
    }
  },
  {
    default: () => null,
  },
)

const startup = computed(() => startupData.value?.data ?? null)

const schema = z.object({
  startup: z.string().trim().min(1, 'Startup command is required').max(2048, 'Startup command is too long'),
  dockerImage: z.string().trim().min(1, 'Docker image is required').max(255, 'Docker image is too long'),
  environment: z.record(z.string()),
})

type FormSchema = z.infer<typeof schema>

function createFormState(payload: StartupForm | null): FormSchema {
  return {
    startup: payload?.startup ?? '',
    dockerImage: payload?.dockerImage ?? '',
    environment: { ...(payload?.environment ?? {}) },
  }
}

const form = reactive<FormSchema>(createFormState(startup.value))

watch(startup, (value) => {
  Object.assign(form, createFormState(value))
})

const environmentVars = computed<EnvironmentEntry[]>(() =>
  Object.entries(form.environment).map(([key, value]) => ({ key, value })),
)

function updateEnvVar(key: string, value: EnvironmentInputValue) {
  if (value === null || value === undefined) {
    form.environment[key] = ''
    return
  }

  if (typeof value === 'string') {
    form.environment[key] = value
    return
  }

  form.environment[key] = String(value)
}

function removeEnvVar(key: string) {
  const { [key]: _, ...rest } = form.environment
  form.environment = rest
}

const newEnvKey = ref('')
const newEnvValue = ref('')

const canAddEnv = computed(() => newEnvKey.value.trim().length > 0 && newEnvValue.value.trim().length > 0)

function addEnvVar() {
  if (!canAddEnv.value)
    return

  form.environment[newEnvKey.value] = newEnvValue.value
  newEnvKey.value = ''
  newEnvValue.value = ''
}

async function handleSubmit(event: FormSubmitEvent<FormSchema>) {
  if (isSubmitting.value)
    return

  isSubmitting.value = true

  try {
    await $fetch(`/api/admin/servers/${props.server.id}/startup`, {
      method: 'PATCH',
      body: event.data,
    })

    Object.assign(form, event.data)

    toast.add({
      title: 'Startup updated',
      description: 'Server startup configuration has been saved',
      color: 'success',
    })

    await refresh()
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to update startup configuration',
      color: 'error',
    })
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UForm
    :schema="schema"
    :state="form"
    class="space-y-6"
    :disabled="isSubmitting"
    :validate-on="['input']"
    @submit="handleSubmit"
  >
    <UAlert icon="i-lucide-info" variant="subtle">
      <template #title>Startup Configuration</template>
      <template #description>
        Configure the startup command and environment variables for this server.
      </template>
    </UAlert>

    <div v-if="startupPending" class="space-y-4">
      <UCard class="space-y-3">
        <USkeleton class="h-4 w-1/3" />
        <USkeleton class="h-24 w-full" />
      </UCard>
      <UCard class="space-y-3">
        <USkeleton class="h-4 w-1/4" />
        <USkeleton class="h-10 w-full" />
      </UCard>
    </div>

    <UAlert v-else-if="startupError" color="error" icon="i-lucide-alert-triangle">
      <template #title>Unable to load startup configuration</template>
      <template #description>{{ (startupError as Error).message }}</template>
    </UAlert>

    <template v-else>
      <div class="space-y-4">
        <UFormField label="Startup Command" name="startup" required>
          <UTextarea v-model="form.startup" placeholder="java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}"
            :rows="4" class="w-full" />
          <template #help>
            Use &#123;&#123;VARIABLE&#125;&#125; syntax for environment variables
          </template>
        </UFormField>

        <UFormField label="Docker Image" name="dockerImage" required>
          <UInput v-model="form.dockerImage" placeholder="ghcr.io/pterodactyl/yolks:java-21" class="w-full" />
          <template #help>
            The Docker image to use for this server
          </template>
        </UFormField>
      </div>

      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">Environment Variables</h3>
        </div>

        <div v-if="environmentVars.length === 0" class="rounded-lg border border-default p-8 text-center">
          <UIcon name="i-lucide-variable" class="mx-auto size-8 text-muted-foreground" />
          <p class="mt-2 text-sm text-muted-foreground">
            No environment variables defined
          </p>
        </div>

        <div v-else class="space-y-2">
          <div v-for="envVar in environmentVars" :key="envVar.key"
            class="flex items-center gap-2 rounded-lg border border-default p-3">
            <div class="flex-1 grid gap-2 md:grid-cols-2">
              <div>
                <p class="text-xs text-muted-foreground">Key</p>
                <code class="text-sm font-medium">{{ envVar.key }}</code>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">Value</p>
                <UInput :model-value="envVar.value" size="sm" class="w-full"
                  @update:model-value="updateEnvVar(envVar.key, $event)" />
              </div>
            </div>
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="sm"
              :disabled="isSubmitting"
              @click="removeEnvVar(envVar.key)" />
          </div>
        </div>

        <div class="flex gap-2">
          <UInput v-model="newEnvKey" placeholder="VARIABLE_NAME" size="sm" class="flex-1" />
          <UInput v-model="newEnvValue" placeholder="value" size="sm" class="flex-1" />
          <UButton icon="i-lucide-plus" color="primary" variant="soft" size="sm"
            :disabled="!canAddEnv || isSubmitting" @click="addEnvVar">
            Add
          </UButton>
        </div>
      </div>

      <div class="flex justify-end">
        <UButton type="submit" color="primary" :loading="isSubmitting" :disabled="isSubmitting">
          Save Startup Configuration
        </UButton>
      </div>
    </template>
  </UForm>
</template>

