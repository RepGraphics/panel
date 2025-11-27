export default defineNuxtPlugin(() => {
  if (import.meta.client) {
    const router = useRouter()
    
    const originalResolve = router.resolve.bind(router)
    router.resolve = (to: Parameters<typeof router.resolve>[0]) => {
      if (typeof to === 'string' && to.startsWith('/api/')) {
        return { path: to, matched: [] } as unknown as ReturnType<typeof originalResolve>
      }
      if (typeof to === 'object' && 'path' in to && typeof to.path === 'string' && to.path.startsWith('/api/')) {
        return { path: to.path, matched: [] } as unknown as ReturnType<typeof originalResolve>
      }
      return originalResolve(to)
    }
  }
})

