<script setup lang="ts">
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import { passwordRequestSchema } from '#shared/schema/account'
import type { PasswordRequestBody } from '#shared/types/account'

definePageMeta({
  layout: 'auth',
  auth: false,
})

const toast = useToast()
const router = useRouter()

const fields: AuthFormField[] = [
  {
    name: 'identity',
    type: 'text',
    label: 'Username or Email',
    placeholder: 'Enter your username or email',
    icon: 'i-lucide-mail',
    required: true,
    autocomplete: 'username',
  },
]

const schema = passwordRequestSchema

const loading = ref(false)

const submitProps = computed(() => ({
  label: 'Send reset link',
  icon: 'i-lucide-send',
  block: true,
  variant: 'subtle' as const,
  color: 'primary' as const,
  loading: loading.value,
}))

async function onSubmit(payload: FormSubmitEvent<PasswordRequestBody>) {
  loading.value = true
  try {
    const identity = String(payload.data.identity).trim()
    const body: PasswordRequestBody = { identity }
    await $fetch<{ success: boolean }>('/api/auth/password/request', {
      method: 'POST',
      body,
    })

    toast.add({
      title: 'Check your inbox',
      description: 'If the account exists, a reset email has been sent.',
      color: 'success',
    })

    router.push('/auth/login')
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process request.'
    toast.add({
      title: 'Request failed',
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
    title="Reset your password"
    description="Enter the email address or username associated with your account."
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
