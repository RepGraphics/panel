<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Allocation } from '#shared/types/allocation'

const props = defineProps<{
  nodeId: string
}>()

const toast = useToast()
const page = ref(1)
const pageSize = ref(50)
const filter = ref<'all' | 'assigned' | 'unassigned'>('all')
const isCreating = ref(false)

type SimpleRequestFetch = <T = unknown>(
  input: string,
  options?: {
    method?: string
    body?: unknown
    signal?: AbortSignal
  }
) => Promise<T>

const requestFetch = useRequestFetch() as SimpleRequestFetch

const {
  data: allocationsData,
  pending,
  refresh,
} = await useAsyncData<Allocation[]>(
  `node-allocations-${props.nodeId}`,
  async (_nuxtApp, { signal }) => {
    const response = await requestFetch<{ data: Allocation[] }>(
      `/api/admin/nodes/${props.nodeId}/allocations`,
      { signal },
    )

    return response?.data ?? []
  },
  {
    default: () => [],
  },
)

const allocations = computed<Allocation[]>(() => allocationsData.value ?? [])

const filteredAllocations = computed(() => {
  if (filter.value === 'assigned') {
    return allocations.value.filter((a: Allocation) => a.serverId !== null)
  }
  if (filter.value === 'unassigned') {
    return allocations.value.filter((a: Allocation) => a.serverId === null)
  }
  return allocations.value
})

const paginatedAllocations = computed(() => {
  const start = (page.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredAllocations.value.slice(start, end)
})

const _totalPages = computed(() => Math.ceil(filteredAllocations.value.length / pageSize.value))

const createSchema = z.object({
  ip: z.string().trim().min(1, 'IP address is required').max(255),
  ports: z.string().trim().min(1, 'Provide at least one port'),
  ipAlias: z.string().trim().max(255).optional(),
})

type CreateFormSchema = z.infer<typeof createSchema>

const showCreateModal = ref(false)
const createForm = reactive<CreateFormSchema>({
  ip: '',
  ports: '',
  ipAlias: '',
})

function parsePorts(input: string): number[] {
  const normalized = input.replace(/\s+/g, '')
  if (normalized.includes('-')) {
    const [startRaw, endRaw] = normalized.split('-', 2)
    const start = Number.parseInt(startRaw, 10)
    const end = Number.parseInt(endRaw, 10)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || start > end)
      throw new Error('Provide a valid port range (e.g. 25565-25600)')
    const ports: number[] = []
    for (let port = start; port <= end; port++) {
      ports.push(port)
    }
    return ports
  }

  const segments = normalized.split(',')
  const ports = segments.map(segment => {
    const port = Number.parseInt(segment, 10)
    if (!Number.isFinite(port) || port <= 0)
      throw new Error('Ports must be positive integers')
    return port
  })

  return ports
}

async function createAllocations(event: FormSubmitEvent<CreateFormSchema>) {
  if (isCreating.value)
    return

  isCreating.value = true

  try {
    const ports = parsePorts(event.data.ports)

    await requestFetch(`/api/admin/nodes/${props.nodeId}/allocations`, {
      method: 'POST',
      body: {
        ip: event.data.ip,
        ports,
        ipAlias: event.data.ipAlias ? event.data.ipAlias : undefined,
      },
    })

    toast.add({
      title: 'Allocations created',
      description: `Created ${ports.length} allocation${ports.length === 1 ? '' : 's'}`,
      color: 'success',
    })

    showCreateModal.value = false
    Object.assign(createForm, { ip: '', ports: '', ipAlias: '' })

    await refresh()
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || (error instanceof Error ? error.message : 'Failed to create allocations'),
      color: 'error',
    })
  }
  finally {
    isCreating.value = false
  }
}

const updatingAlias = ref<string | null>(null)

async function updateAlias(allocation: Allocation, newAlias: string) {
  updatingAlias.value = allocation.id
  try {
    await requestFetch(`/api/admin/allocations/${allocation.id}`, {
      method: 'PATCH',
      body: { ipAlias: newAlias || null },
    })

    toast.add({
      title: 'Alias updated',
      color: 'success',
    })

    await refresh()
  } catch {
    toast.add({
      title: 'Error',
      description: 'Failed to update alias',
      color: 'error',
    })
  } finally {
    updatingAlias.value = null
  }
}

async function deleteAllocation(allocation: Allocation) {
  if (!confirm(`Delete allocation ${allocation.ip}:${allocation.port}?`)) {
    return
  }

  try {
    await requestFetch(`/api/admin/allocations/${allocation.id}`, {
      method: 'DELETE',
    })

    toast.add({
      title: 'Allocation deleted',
      color: 'success',
    })

    await refresh()
  } catch (err) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: error.data?.message || 'Failed to delete allocation',
      color: 'error',
    })
  }
}

const columns: Array<{ key: string, label: string }> = [
  { key: 'ip', label: 'IP Address' },
  { key: 'ipAlias', label: 'IP Alias' },
  { key: 'port', label: 'Port' },
  { key: 'server', label: 'Assigned To' },
  { key: 'actions', label: '' },
]
</script>

<template>
  <div class="space-y-4">

    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex gap-2">
        <UButton :color="filter === 'all' ? 'primary' : 'neutral'" variant="soft" @click="filter = 'all'">
          All ({{ allocations.length }})
        </UButton>
        <UButton :color="filter === 'assigned' ? 'primary' : 'neutral'" variant="soft" @click="filter = 'assigned'">
          Assigned ({{allocations.filter((a: Allocation) => a.serverId).length}})
        </UButton>
        <UButton :color="filter === 'unassigned' ? 'primary' : 'neutral'" variant="soft" @click="filter = 'unassigned'">
          Unassigned ({{allocations.filter((a: Allocation) => !a.serverId).length}})
        </UButton>
      </div>

      <UButton icon="i-lucide-plus" color="primary" @click="showCreateModal = true">
        Create Allocations
      </UButton>
    </div>

    <UCard>
      <UTable :rows="paginatedAllocations as Allocation[]" :columns="columns as any" :loading="pending">
        <template #ip-data="{ row }">
          <code class="text-sm">{{ (row as unknown as Allocation).ip }}</code>
        </template>

        <template #ipAlias-data="{ row }">
          <UInput :model-value="(row as unknown as Allocation).ipAlias || ''" placeholder="none" size="sm"
            :loading="updatingAlias === (row as unknown as Allocation).id"
            @blur="updateAlias(row as unknown as Allocation, ($event.target as HTMLInputElement).value)" />
        </template>

        <template #port-data="{ row }">
          <code class="text-sm">{{ (row as unknown as Allocation).port }}</code>
        </template>

        <template #server-data="{ row }">
          <NuxtLink v-if="(row as unknown as Allocation).serverId"
            :to="`/admin/servers/${(row as unknown as Allocation).serverId}`" class="text-primary hover:underline">
            Server
          </NuxtLink>
          <span v-else class="text-sm text-muted-foreground">-</span>
        </template>

        <template #actions-data="{ row }">
          <UButton v-if="!(row as unknown as Allocation).serverId" icon="i-lucide-trash-2" color="error" variant="ghost"
            size="sm" @click="deleteAllocation(row as unknown as Allocation)" />
        </template>
      </UTable>

      <template #footer>
        <div class="flex items-center justify-between">
          <div class="text-sm text-muted-foreground">
            Showing {{ (page - 1) * pageSize + 1 }} to {{ Math.min(page * pageSize, filteredAllocations.length) }} of {{
              filteredAllocations.length }}
          </div>
          <UPagination v-model="page" :total="filteredAllocations.length" :page-size="pageSize" />
        </div>
      </template>
    </UCard>

    <UModal v-model="showCreateModal">
      <UCard>
        <template #header>
          <h3 class="text-lg font-semibold">Create Allocations</h3>
        </template>

        <UForm
          :schema="createSchema"
          :state="createForm"
          class="space-y-4"
          :disabled="isCreating"
          validate-on="input"
          @submit="createAllocations"
        >
          <UAlert icon="i-lucide-info">
            <template #title>Bulk Creation</template>
            <template #description>
              You can create multiple allocations at once by specifying a port range (e.g., 25565-25665) or
              comma-separated ports (e.g., 25565,25566,25567).
            </template>
          </UAlert>

          <UFormField label="IP Address" name="ip" required>
            <UInput v-model="createForm.ip" placeholder="0.0.0.0" />
            <template #help>
              The IP address to bind allocations to
            </template>
          </UFormField>

          <UFormField label="Ports" name="ports" required>
            <UInput v-model="createForm.ports" placeholder="25565-25665 or 25565,25566,25567" />
            <template #help>
              Port range (25565-25665) or comma-separated list (25565,25566,25567)
            </template>
          </UFormField>

          <UFormField label="IP Alias" name="ipAlias">
            <UInput v-model="createForm.ipAlias" placeholder="play.example.com" />
            <template #help>
              Optional DNS alias for this IP address
            </template>
          </UFormField>
        </UForm>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" :disabled="isCreating" @click="showCreateModal = false">
              Cancel
            </UButton>
            <UButton color="primary" :loading="isCreating" :disabled="isCreating" @click="createAllocations">
              Create Allocations
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>
