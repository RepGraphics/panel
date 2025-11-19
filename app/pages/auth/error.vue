<script setup lang="ts">
interface AuthErrorContent {
  title: string
  description: string
}

const route = useRoute()

const defaultError: AuthErrorContent = {
  title: 'Authentication Error',
  description: 'An unexpected error occurred while signing you in.',
}

const errorCatalog: Record<string, AuthErrorContent> = {
  Configuration: {
    title: 'Configuration Issue',
    description: 'There is a problem with the authentication configuration. Please contact support.',
  },
  AccessDenied: {
    title: 'Access Restricted',
    description: 'Access to this application is currently restricted for your account.',
  },
  Verification: {
    title: 'Verification Problem',
    description: 'The verification link has expired or was already used. Request a new one to continue.',
  },
  CredentialsSignin: {
    title: 'Incorrect Credentials',
    description: 'We could not verify your username or password. Double-check your information and try again.',
  },
  SessionRequired: {
    title: 'Session Required',
    description: 'Please sign in again to continue.',
  },
  Default: defaultError,
}

const errorCode = computed(() => {
  const code = route.query.error
  return typeof code === 'string' && code.length > 0 ? code : 'Default'
})

const customMessage = computed(() => {
  const message = route.query.message
  return typeof message === 'string' && message.trim().length > 0 ? message.trim() : null
})

const errorContent = computed<AuthErrorContent>(() => {
  const fallback = defaultError
  const catalogEntry = errorCatalog[errorCode.value]
  const resolved: AuthErrorContent = catalogEntry ?? fallback

  return {
    title: resolved.title,
    description: customMessage.value ?? resolved.description,
  }
})

definePageMeta({
  layout: 'auth',
  auth: {
    unauthenticatedOnly: true,
    navigateAuthenticatedTo: '/',
  },
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-alert-circle" class="size-5 text-destructive" />
          <div>
            <h2 class="text-lg font-semibold">
              {{ errorContent.title }}
            </h2>
            <UBadge variant="soft" color="neutral" class="mt-1 uppercase tracking-wide">
              {{ errorCode }}
            </UBadge>
          </div>
        </div>
      </div>
    </template>

    <p class="text-sm text-muted-foreground">
      {{ errorContent.description }}
    </p>

    <template #footer>
      <UButton to="/auth/login" icon="i-lucide-arrow-left" color="primary" variant="subtle" block>
        Return to Login
      </UButton>
    </template>
  </UCard>
</template>
