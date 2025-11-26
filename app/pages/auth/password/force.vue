<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import { accountForcedPasswordSchema } from '#shared/schema/account'
import type { PasswordForceBody } from '#shared/types/account'

const authStore = useAuthStore()
const { status, requiresPasswordReset } = storeToRefs(authStore)
const route = useRoute()
const toast = useToast()

definePageMeta({
  layout: 'auth',
  auth: true,
})

const schema = accountForcedPasswordSchema

const fields: AuthFormField[] = [
  {
    name: 'newPassword',
    type: 'password',
    label: 'New password',
    placeholder: 'Enter your new password',
    icon: 'i-lucide-key',
    required: true,
    autocomplete: 'new-password',
  },
  {
    name: 'confirmPassword',
    type: 'password',
    label: 'Confirm password',
    placeholder: 'Re-enter the new password',
    icon: 'i-lucide-shield-check',
    required: true,
    autocomplete: 'new-password',
  },
]

const loading = ref(false)
const errorMessage = ref<string | null>(null)

const submitProps = computed(() => ({
  label: 'Update password',
  icon: 'i-lucide-save',
  block: true,
  variant: 'subtle' as const,
  color: 'primary' as const,
  loading: loading.value,
}))

const redirectPath = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/'))
    return redirect
  return '/'
})

watch(status, async (value) => {
  if (value === 'authenticated' && !requiresPasswordReset.value)
    await navigateTo(redirectPath.value)
}, { immediate: true })

async function onSubmit(event: FormSubmitEvent<PasswordForceBody>) {
  loading.value = true
  errorMessage.value = null
  try {
    const newPassword = String(event.data.newPassword)
    const confirmPassword = event.data.confirmPassword ? String(event.data.confirmPassword) : undefined
    const body: PasswordForceBody = {
      newPassword,
      confirmPassword,
    }
    await $fetch<{ success: boolean }>('/api/account/password/force', {
      method: 'PUT',
      body,
    })

    await authStore.syncSession({ force: true })

    toast.add({
      title: 'Password updated',
      description: 'Your password has been changed successfully.',
      color: 'success',
    })

    await navigateTo(redirectPath.value)
  }
  catch (error) {
    const fetchError = error as FetchError<{ message?: string }>
    const message = fetchError?.data?.message
      ?? (error instanceof Error ? error.message : 'Unable to update password.')
    errorMessage.value = message
    toast.add({
      title: 'Password update failed',
      description: message,
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UAuthForm
    :schema="schema"
    :fields="fields"
    title="Password reset required"
    description="Choose a new password to continue to your account."
    icon="i-lucide-key-round"
    :submit="submitProps"
    @submit="onSubmit as any"
  >
    <template #validation>
      <UAlert
        v-if="errorMessage"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        :title="errorMessage"
      />
    </template>
  </UAuthForm>
</template>
