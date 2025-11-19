<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { MailSettings } from '#shared/types/admin-settings'

const toast = useToast()
const isSubmitting = ref(false)
const isTesting = ref(false)

const driverEnumValues = ['smtp', 'sendmail', 'mailgun'] as const
type DriverValue = (typeof driverEnumValues)[number]
const driverOptions = [
  { label: 'SMTP', value: driverEnumValues[0] },
  { label: 'Sendmail', value: driverEnumValues[1] },
  { label: 'Mailgun', value: driverEnumValues[2] },
] satisfies { label: string; value: DriverValue }[]

const encryptionEnumValues = ['tls', 'ssl', 'none'] as const
type EncryptionValue = (typeof encryptionEnumValues)[number]
const encryptionOptions = [
  { label: 'TLS', value: encryptionEnumValues[0] },
  { label: 'SSL', value: encryptionEnumValues[1] },
  { label: 'None', value: encryptionEnumValues[2] },
] satisfies { label: string; value: EncryptionValue }[]

const schema = z.object({
  driver: z.enum(driverEnumValues),
  host: z.string().trim().max(255),
  port: z.string().trim().max(5),
  username: z.string().trim().max(255),
  password: z.string().max(255),
  encryption: z.enum(encryptionEnumValues),
  fromAddress: z.string().trim().email('Enter a valid email address'),
  fromName: z.string().trim().min(1, 'Sender name is required').max(120, 'Sender name must be under 120 characters'),
}).superRefine((data, ctx) => {
  if (data.driver !== 'sendmail') {
    if (data.host.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['host'],
        message: 'SMTP host is required',
      })
    }

    if (data.port.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['port'],
        message: 'SMTP port is required',
      })
    }
  }

  if (data.port.length > 0) {
    if (!/^\d+$/.test(data.port)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['port'],
        message: 'Port must be numeric',
      })
    }
    else {
      const port = Number.parseInt(data.port, 10)
      if (Number.isNaN(port) || port <= 0 || port > 65535) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['port'],
          message: 'Port must be between 1 and 65535',
        })
      }
    }
  }
})

type FormSchema = z.infer<typeof schema>

function createFormState(source?: MailSettings | null): FormSchema {
  return {
    driver: (source?.driver as DriverValue | undefined) ?? 'smtp',
    host: source?.host ?? '',
    port: source?.port ?? '587',
    username: source?.username ?? '',
    password: source?.password ?? '',
    encryption: (source?.encryption as EncryptionValue | undefined) ?? 'tls',
    fromAddress: source?.fromAddress ?? '',
    fromName: source?.fromName ?? '',
  }
}

const { data: settings, refresh } = await useFetch<MailSettings>('/api/admin/settings/mail', {
  key: 'admin-settings-mail',
})

const form = reactive<FormSchema>(createFormState(settings.value))
const disableSmtpFields = computed(() => form.driver === 'sendmail')

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
    host: event.data.driver === 'sendmail' ? '' : event.data.host,
    port: event.data.driver === 'sendmail' ? '' : event.data.port,
  }

  try {
    await $fetch('/api/admin/settings/mail', {
      method: 'PATCH',
      body: payload,
    })

    Object.assign(form, payload)

    toast.add({
      title: 'Settings updated',
      description: 'Mail settings have been saved successfully',
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

async function handleTestEmail() {
  if (isTesting.value || isSubmitting.value)
    return

  isTesting.value = true

  try {
    await $fetch('/api/admin/settings/mail/test', {
      method: 'POST',
    })

    toast.add({
      title: 'Test email sent',
      description: 'Check your inbox for the test email',
      color: 'success',
    })
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to send test email',
      color: 'error',
    })
  }
  finally {
    isTesting.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">Mail Settings</h2>
          <p class="text-sm text-muted-foreground">Configure SMTP settings for email notifications</p>
        </div>
        <UButton icon="i-lucide-mail" color="primary" variant="soft" :loading="isTesting"
          :disabled="isTesting || isSubmitting" @click="handleTestEmail">
          Send Test Email
        </UButton>
      </div>
    </template>

    <UForm
      :schema="schema"
      :state="form"
      class="space-y-4"
      :disabled="isSubmitting"
      :validate-on="['input']"
      @submit="handleSubmit"
    >
      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="Mail Driver" name="driver" required>
          <USelect v-model="form.driver" :items="driverOptions" value-key="value" :disabled="isSubmitting" />
        </UFormField>

        <UFormField label="Encryption" name="encryption" required>
          <USelect v-model="form.encryption" :items="encryptionOptions" value-key="value" :disabled="isSubmitting" />
        </UFormField>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="SMTP Host" name="host" required>
          <UInput v-model="form.host" placeholder="smtp.gmail.com" :disabled="isSubmitting || disableSmtpFields" class="w-full" />
        </UFormField>

        <UFormField label="SMTP Port" name="port" required>
          <UInput v-model="form.port" type="number" placeholder="587" :disabled="isSubmitting || disableSmtpFields" class="w-full" />
        </UFormField>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="Username" name="username">
          <UInput v-model="form.username" placeholder="user@example.com" :disabled="isSubmitting" class="w-full" />
        </UFormField>

        <UFormField label="Password" name="password">
          <UInput v-model="form.password" type="password" placeholder="••••••••" :disabled="isSubmitting" class="w-full" />
        </UFormField>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="From Address" name="fromAddress" required>
          <UInput v-model="form.fromAddress" type="email" placeholder="noreply@example.com" :disabled="isSubmitting" class="w-full" />
        </UFormField>

        <UFormField label="From Name" name="fromName" required>
          <UInput v-model="form.fromName" placeholder="XyraPanel" :disabled="isSubmitting" class="w-full" />
        </UFormField>
      </div>

      <div class="flex justify-end">
        <UButton type="submit" color="primary" :loading="isSubmitting" :disabled="isSubmitting || isTesting">
          Save Changes
        </UButton>
      </div>
    </UForm>
  </UCard>
</template>
