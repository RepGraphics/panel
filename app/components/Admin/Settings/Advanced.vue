<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { AdvancedSettings } from '#shared/types/admin-settings'

const toast = useToast()
const isSubmitting = ref(false)

const schema = z.object({
  telemetryEnabled: z.boolean(),
  debugMode: z.boolean(),
  recaptchaEnabled: z.boolean(),
  recaptchaSiteKey: z.string().trim().max(255),
  recaptchaSecretKey: z.string().trim().max(255),
  sessionTimeoutMinutes: z.number({ invalid_type_error: 'Session timeout is required' })
    .int('Session timeout must be a whole number')
    .min(5, 'Minimum 5 minutes')
    .max(1440, 'Maximum 1440 minutes (24 hours)'),
  queueConcurrency: z.number({ invalid_type_error: 'Queue concurrency is required' })
    .int('Concurrency must be a whole number')
    .min(1, 'Minimum 1 worker')
    .max(32, 'Maximum 32 workers'),
  queueRetryLimit: z.number({ invalid_type_error: 'Queue retry limit is required' })
    .int('Retry limit must be a whole number')
    .min(1, 'Minimum 1 retry')
    .max(50, 'Maximum 50 retries'),
}).superRefine((data, ctx) => {
  if (data.recaptchaEnabled) {
    if (data.recaptchaSiteKey.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recaptchaSiteKey'],
        message: 'Site key required when reCAPTCHA is enabled',
      })
    }
    if (data.recaptchaSecretKey.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recaptchaSecretKey'],
        message: 'Secret key required when reCAPTCHA is enabled',
      })
    }
  }
})

type FormSchema = z.infer<typeof schema>

function createFormState(source?: AdvancedSettings | null): FormSchema {
  return {
    telemetryEnabled: source?.telemetryEnabled ?? true,
    debugMode: source?.debugMode ?? false,
    recaptchaEnabled: source?.recaptchaEnabled ?? false,
    recaptchaSiteKey: source?.recaptchaSiteKey ?? '',
    recaptchaSecretKey: source?.recaptchaSecretKey ?? '',
    sessionTimeoutMinutes: source?.sessionTimeoutMinutes ?? 60,
    queueConcurrency: source?.queueConcurrency ?? 4,
    queueRetryLimit: source?.queueRetryLimit ?? 5,
  }
}

const { data: settings, refresh } = await useFetch<AdvancedSettings>('/api/admin/settings/advanced', {
  key: 'admin-settings-advanced',
})

const form = reactive<FormSchema>(createFormState(settings.value))

const showRecaptchaFields = computed(() => form.recaptchaEnabled)

watch(settings, (newSettings) => {
  if (!newSettings)
    return

  Object.assign(form, createFormState(newSettings))
})

async function handleSubmit(event: FormSubmitEvent<FormSchema>) {
  if (isSubmitting.value)
    return

  isSubmitting.value = true

  const payload: FormSchema = {
    ...event.data,
    recaptchaSiteKey: event.data.recaptchaEnabled ? event.data.recaptchaSiteKey : '',
    recaptchaSecretKey: event.data.recaptchaEnabled ? event.data.recaptchaSecretKey : '',
  }

  try {
    await $fetch('/api/admin/settings/advanced', {
      method: 'PATCH',
      body: payload,
    })

    Object.assign(form, payload)

    toast.add({
      title: 'Settings updated',
      description: 'Advanced settings have been saved successfully',
      color: 'success',
    })

    await refresh()
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to update settings',
      color: 'error',
    })
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-lg font-semibold">Advanced Settings</h2>
      <p class="text-sm text-muted-foreground">Configure advanced panel features and integrations</p>
    </template>

    <UForm
      :schema="schema"
      :state="form"
      class="space-y-6"
      :disabled="isSubmitting"
      :validate-on="['input']"
      @submit="handleSubmit"
    >

      <div class="space-y-4">
        <h3 class="text-sm font-semibold">System</h3>

        <UFormField name="telemetryEnabled">
          <USwitch v-model="form.telemetryEnabled" label="Enable anonymous telemetry" :disabled="isSubmitting" />
        </UFormField>

        <UFormField name="debugMode">
          <USwitch v-model="form.debugMode" label="Enable debug mode" description="Shows verbose logs and stack traces" :disabled="isSubmitting" />
        </UFormField>
      </div>

      <div class="space-y-4">
        <h3 class="text-sm font-semibold">reCAPTCHA</h3>

        <UFormField name="recaptchaEnabled">
          <USwitch
            v-model="form.recaptchaEnabled"
            label="Enable Google reCAPTCHA"
            description="Protect login and registration forms"
            :disabled="isSubmitting"
          />
        </UFormField>

        <div v-if="showRecaptchaFields" class="space-y-4">
          <UFormField label="Site Key" name="recaptchaSiteKey" required>
            <UInput v-model="form.recaptchaSiteKey" placeholder="6Lc..." :disabled="isSubmitting" class="w-full" />
            <template #help>
              Get your keys from <a href="https://www.google.com/recaptcha/admin" target="_blank"
                class="text-primary hover:underline">Google reCAPTCHA</a>
            </template>
          </UFormField>

          <UFormField label="Secret Key" name="recaptchaSecretKey" required>
            <UInput v-model="form.recaptchaSecretKey" type="password" placeholder="6Lc..." :disabled="isSubmitting" class="w-full" />
          </UFormField>
        </div>
      </div>

      <div class="space-y-4">
        <h3 class="text-sm font-semibold">Sessions & Queue</h3>
        <div class="grid gap-4 md:grid-cols-3">
          <UFormField label="Session timeout" name="sessionTimeoutMinutes" required>
            <UInput v-model.number="form.sessionTimeoutMinutes" type="number" min="5" max="1440"
              suffix="min" :disabled="isSubmitting" class="w-full" />
            <template #description>
              <span class="text-xs text-muted-foreground">After this period of inactivity users are signed out.</span>
            </template>
          </UFormField>

          <UFormField label="Queue concurrency" name="queueConcurrency" required>
            <UInput v-model.number="form.queueConcurrency" type="number" min="1" max="32" :disabled="isSubmitting" class="w-full" />
            <template #description>
              <span class="text-xs text-muted-foreground"># of jobs that can run in parallel.</span>
            </template>
          </UFormField>

          <UFormField label="Queue retry limit" name="queueRetryLimit" required>
            <UInput v-model.number="form.queueRetryLimit" type="number" min="1" max="50" :disabled="isSubmitting" class="w-full" />
            <template #description>
              <span class="text-xs text-muted-foreground">Max attempts before a job is marked failed.</span>
            </template>
          </UFormField>
        </div>
      </div>

      <div class="flex justify-end">
        <UButton type="submit" color="primary" :loading="isSubmitting" :disabled="isSubmitting">
          Save Changes
        </UButton>
      </div>
    </UForm>
  </UCard>
</template>
