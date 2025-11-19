<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SecuritySettings } from '#shared/types/admin-settings'

const toast = useToast()
const isSubmitting = ref(false)

const rawSchema = z.object({
  enforceTwoFactor: z.boolean(),
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().trim().max(500, 'Maintenance message must be 500 characters or fewer'),
  announcementEnabled: z.boolean(),
  announcementMessage: z.string().trim().max(500, 'Announcement message must be 500 characters or fewer'),
})

const schema = rawSchema.superRefine((data, ctx) => {
  if (data.maintenanceMode && data.maintenanceMessage.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maintenanceMessage'],
      message: 'Provide a maintenance message to show users.',
    })
  }

  if (data.announcementEnabled && data.announcementMessage.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['announcementMessage'],
      message: 'Write the announcement content before enabling the banner.',
    })
  }
})

type FormSchema = z.infer<typeof schema>

function createFormState(source?: SecuritySettings | null): FormSchema {
  return {
    enforceTwoFactor: source?.enforceTwoFactor ?? false,
    maintenanceMode: source?.maintenanceMode ?? false,
    maintenanceMessage: source?.maintenanceMessage ?? '',
    announcementEnabled: source?.announcementEnabled ?? false,
    announcementMessage: source?.announcementMessage ?? '',
  }
}

const { data: settings, refresh } = await useFetch<SecuritySettings>('/api/admin/settings/security', {
  key: 'admin-settings-security',
})

const form = reactive<FormSchema>(createFormState(settings.value))

watch(settings, (value) => {
  if (!value)
    return

  Object.assign(form, createFormState(value))
})

async function handleSubmit(event: FormSubmitEvent<FormSchema>) {
  if (isSubmitting.value)
    return

  isSubmitting.value = true

  const payload: FormSchema = {
    ...event.data,
    maintenanceMessage: event.data.maintenanceMode ? event.data.maintenanceMessage : event.data.maintenanceMessage || '',
    announcementMessage: event.data.announcementEnabled ? event.data.announcementMessage : event.data.announcementMessage || '',
  }

  try {
    await $fetch('/api/admin/settings/security', {
      method: 'PATCH',
      body: payload,
    })

    Object.assign(form, payload)

    toast.add({
      title: 'Security settings saved',
      description: 'Safety and maintenance preferences were updated successfully.',
      color: 'success',
    })

    await refresh()
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Update failed',
      description: err.data?.message || 'Unable to save security settings. Try again.',
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
      <h2 class="text-lg font-semibold">Security</h2>
    </template>

    <UForm
      :schema="schema"
      :state="form"
      class="space-y-6"
      :disabled="isSubmitting"
      :validate-on="['input']"
      @submit="handleSubmit"
    >
      <div class="space-y-3">
        <UFormField name="enforceTwoFactor">
          <USwitch v-model="form.enforceTwoFactor" label="Enforce admin two-factor login" :disabled="isSubmitting" />
        </UFormField>
      </div>

      <div class="space-y-3">
        <UFormField name="maintenanceMode">
          <USwitch v-model="form.maintenanceMode" label="Enable maintenance mode" :disabled="isSubmitting" />
        </UFormField>

        <transition name="fade">
          <UFormField v-if="form.maintenanceMode" label="Maintenance message" name="maintenanceMessage">
            <UTextarea v-model="form.maintenanceMessage" placeholder="Maintenance message" :rows="3"
              :disabled="isSubmitting" class="w-full" />
          </UFormField>
        </transition>
      </div>

      <div class="space-y-3">
        <UFormField name="announcementEnabled">
          <USwitch v-model="form.announcementEnabled" label="Enable announcement banner" :disabled="isSubmitting" />
        </UFormField>

        <transition name="fade">
          <UFormField v-if="form.announcementEnabled" label="Announcement message" name="announcementMessage">
            <UTextarea v-model="form.announcementMessage" placeholder="Announcement message" :rows="3"
              :disabled="isSubmitting" class="w-full" />
          </UFormField>
        </transition>
      </div>

      <div class="flex justify-end">
        <UButton type="submit" color="primary" :loading="isSubmitting" :disabled="isSubmitting">
          Save changes
        </UButton>
      </div>
    </UForm>
  </UCard>
</template>
