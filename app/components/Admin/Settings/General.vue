<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { GeneralSettings } from '#shared/types/admin'

const toast = useToast()
const isSubmitting = ref(false)

const localeEnumValues = ['en', 'de', 'fr', 'es'] as const
type LocaleValue = (typeof localeEnumValues)[number]
const localeOptions = [
  { label: 'English', value: localeEnumValues[0] },
  { label: 'German', value: localeEnumValues[1] },
  { label: 'French', value: localeEnumValues[2] },
  { label: 'Spanish', value: localeEnumValues[3] },
] satisfies { label: string; value: LocaleValue }[]

const timezoneEnumValues = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
] as const
type TimezoneValue = (typeof timezoneEnumValues)[number]
const timezoneOptions = [
  { label: 'UTC', value: timezoneEnumValues[0] },
  { label: 'America/New_York', value: timezoneEnumValues[1] },
  { label: 'America/Los_Angeles', value: timezoneEnumValues[2] },
  { label: 'Europe/London', value: timezoneEnumValues[3] },
  { label: 'Europe/Paris', value: timezoneEnumValues[4] },
  { label: 'Asia/Tokyo', value: timezoneEnumValues[5] },
] satisfies { label: string; value: TimezoneValue }[]

const schema = z.object({
  name: z.string().trim().min(2, 'Panel name must be at least 2 characters'),
  url: z.string().trim().pipe(z.url('Enter a valid URL')),
  locale: z.enum(localeEnumValues, { message: 'Select a default language' }),
  timezone: z.enum(timezoneEnumValues, { message: 'Select a timezone' }),
  brandText: z.string().trim().max(80, 'Brand text must be 80 characters or less'),
  showBrandText: z.boolean(),
  showBrandLogo: z.boolean(),
  brandLogoUrl: z.preprocess(
    (value) => {
      if (value === '' || value === undefined)
        return null
      return value
    },
    z.string().trim().pipe(z.url('Provide a valid logo URL')).nullable(),
  ),
})

type FormSchema = z.infer<typeof schema>

const { data: settings, refresh } = await useAsyncData(
  'admin-settings-general',
  async () => {
    const response = await fetch('/api/admin/settings/general')
    if (!response.ok) {
      throw new Error(`Failed to fetch general settings: ${response.statusText}`)
    }
    return await response.json() as GeneralSettings
  },
)

function resolveLocale(value: string | null | undefined): LocaleValue {
  return (localeEnumValues.includes(value as LocaleValue) ? value : localeEnumValues[0]) as LocaleValue
}

function resolveTimezone(value: string | null | undefined): TimezoneValue {
  return (timezoneEnumValues.includes(value as TimezoneValue) ? value : timezoneEnumValues[0]) as TimezoneValue
}

function createFormState(source?: GeneralSettings | null): FormSchema {
  return {
    name: source?.name ?? '',
    url: source?.url ?? '',
    locale: resolveLocale(source?.locale),
    timezone: resolveTimezone(source?.timezone),
    brandText: source?.brandText ?? source?.name ?? '',
    showBrandText: source?.showBrandText ?? true,
    showBrandLogo: source?.showBrandLogo ?? false,
    brandLogoUrl: source?.brandLogoUrl ?? null,
  }
}

const form = reactive<FormSchema>(createFormState(settings.value))

const logoFile = ref<File | null>(null)
const logoUploading = ref(false)

watch(settings, (newSettings) => {
  Object.assign(form, createFormState(newSettings ?? null))
})

watch(logoFile, async (file) => {
  if (!file)
    return

  logoUploading.value = true
  try {
    const body = new FormData()
    body.append('logo', file)

    const response = await $fetch<{ url: string }>('/api/admin/settings/branding/logo', {
      method: 'POST',
      body,
    })

    form.brandLogoUrl = response.url
    form.showBrandLogo = true

    toast.add({
      title: 'Logo uploaded',
      description: 'Brand logo has been updated',
      color: 'success',
    })

    await refresh()
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Upload failed',
      description: err.data?.message || 'Unable to upload logo. Please try again.',
      color: 'error',
    })
  }
  finally {
    logoUploading.value = false
    logoFile.value = null
  }
})

async function removeLogo() {
  try {
    await $fetch('/api/admin/settings/general', {
      method: 'patch',
      body: {
        brandLogoUrl: null,
        showBrandLogo: false,
      },
    })

    form.brandLogoUrl = null
    form.showBrandLogo = false

    toast.add({
      title: 'Logo removed',
      description: 'Brand logo has been cleared',
      color: 'success',
    })

    await refresh()
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to remove logo',
      color: 'error',
    })
  }
}

async function handleSubmit(event: FormSubmitEvent<FormSchema>) {
  if (isSubmitting.value)
    return

  isSubmitting.value = true

  try {
    const payload = {
      ...event.data,
      brandLogoUrl: event.data.brandLogoUrl ?? null,
    }

    await $fetch('/api/admin/settings/general', {
      method: 'patch',
      body: payload,
    })

    Object.assign(form, payload)

    toast.add({
      title: 'Settings updated',
      description: 'General settings have been saved successfully',
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
      <h2 class="text-lg font-semibold">General Settings</h2>
      <p class="text-sm text-muted-foreground">Configure basic panel information</p>
    </template>

    <UForm
      ref="generalSettingsForm"
      :schema="schema"
      :state="form"
      class="space-y-4"
      :disabled="isSubmitting"
      :validate-on="['input']"
      @submit="handleSubmit"
    >
      <UFormField label="Panel Name" name="name" required>
        <UInput v-model="form.name" placeholder="XyraPanel" :disabled="isSubmitting" class="w-full" />
      </UFormField>

      <UFormField label="Panel URL" name="url" required>
        <UInput v-model="form.url" type="url" placeholder="https://panel.example.com" :disabled="isSubmitting" class="w-full" />
      </UFormField>

      <UFormField label="Language" name="locale" required>
        <USelect v-model="form.locale" :items="localeOptions" value-key="value" :disabled="isSubmitting" />
      </UFormField>

      <UFormField label="Timezone" name="timezone" required>
        <USelect v-model="form.timezone" :items="timezoneOptions" value-key="value" :disabled="isSubmitting" />
      </UFormField>

      <USeparator />

      <div class="space-y-4">
        <div>
          <h3 class="text-sm font-medium">Branding</h3>
          <p class="text-xs text-muted-foreground">Control how the panel brand appears in the dashboard.</p>
        </div>

        <UFormField label="Brand text" name="brandText">
          <UInput v-model="form.brandText" placeholder="XyraPanel" :disabled="isSubmitting" class="w-full" />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="Show brand text" name="showBrandText">
            <div class="flex items-center justify-between rounded-lg border border-default p-3">
              <p class="text-sm text-muted-foreground">Display the brand text in the sidebar.</p>
              <USwitch v-model="form.showBrandText" />
            </div>
          </UFormField>

          <UFormField label="Show brand logo" name="showBrandLogo">
            <div class="flex items-center justify-between rounded-lg border border-default p-3">
              <p class="text-sm text-muted-foreground">Display the uploaded logo in the sidebar.</p>
              <USwitch v-model="form.showBrandLogo" />
            </div>
          </UFormField>
        </div>

        <div class="space-y-3">
          <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Logo</p>
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-3">
              <UAvatar :src="form.brandLogoUrl || undefined" icon="i-lucide-image" size="lg" />
              <div class="text-xs text-muted-foreground">
                <p v-if="form.brandLogoUrl">Current logo</p>
                <p v-else>No logo uploaded</p>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UFileUpload v-model="logoFile" accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                class="w-56" label="Upload logo" description="PNG, JPG, SVG, WEBP up to 2MB"
                :disabled="logoUploading" />
              <UButton v-if="form.brandLogoUrl" variant="ghost" color="error" size="sm" icon="i-lucide-trash"
                @click="removeLogo">
                Remove logo
              </UButton>
            </div>
          </div>
          <p class="text-[11px] text-muted-foreground">Logos are stored at 256px width (max 2MB).</p>
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
