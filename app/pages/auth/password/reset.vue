<script setup lang="ts">
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import { passwordResetSchema, type PasswordResetInput } from '#shared/schema/account'
import type { PasswordResetBody } from '#shared/types/account'

definePageMeta({
  layout: 'auth',
  auth: false,
})

const toast = useToast()
const router = useRouter()
const route = useRoute()

const fields: AuthFormField[] = [
  {
    name: 'token',
    type: 'text',
    label: 'Reset Token',
    placeholder: 'Paste the token from your email',
    icon: 'i-lucide-key',
    required: true,
    autocomplete: 'off',
  },
  {
    name: 'password',
    type: 'password',
    label: 'New Password',
    placeholder: 'Enter your new password',
    icon: 'i-lucide-lock',
    required: true,
    autocomplete: 'new-password',
  },
  {
    name: 'confirmPassword',
    type: 'password',
    label: 'Confirm Password',
    placeholder: 'Re-enter your password',
    icon: 'i-lucide-shield-check',
    required: true,
    autocomplete: 'new-password',
  },
]

const schema = passwordResetSchema

const loading = ref(false)

const submitProps = computed(() => ({
  label: 'Update password',
  icon: 'i-lucide-save',
  block: true,
  variant: 'subtle' as const,
  color: 'primary' as const,
  loading: loading.value,
}))

const initialToken = computed(() => {
  return typeof route.query.token === 'string' ? route.query.token : ''
})

async function onSubmit(payload: FormSubmitEvent<PasswordResetInput>) {
  loading.value = true
  try {
    const formData = payload.data
    const token = String(formData.token || initialToken.value).trim()
    
    if (!token) {
      throw new Error('Reset token is required')
    }

    const newPassword = String(formData.password).trim()
    
    const requestBody: PasswordResetBody = {
      token,
      newPassword,
    }
    
    await $fetch('/api/auth/password/reset', {
      method: 'POST',
      body: requestBody,
    })

    toast.add({
      title: 'Password updated',
      description: 'You can now sign in with your new password.',
      color: 'success',
    })

    router.push('/auth/login')
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reset password.'
    toast.add({
      title: 'Reset failed',
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
    title="Set a new password"
    description="Enter your reset token and choose a new password."
    icon="i-lucide-key-round"
    :submit="submitProps"
    @submit="onSubmit as any"
  >
    <template #footer>
      <NuxtLink to="/auth/login" class="text-primary font-medium">
        Back to sign in
      </NuxtLink>
    </template>
  </UAuthForm>
</template>
