<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent, TableColumn } from '@nuxt/ui'
import type { Allocation } from '#shared/types/server'

const props = defineProps<{
  nodeId: string
}>()

const toast = useToast()
const page = ref(1)
const pageSize = ref(50)
const filter = ref<'all' | 'assigned' | 'unassigned'>('all')
const isCreating = ref(false)

const allocationsData = ref<{ data: Allocation[] } | null>(null)
const pending = ref(false)

async function loadAllocations() {
  pending.value = true
  try {
    const response = await $fetch<{ data: Allocation[] }>(`/api/admin/nodes/${props.nodeId}/allocations`)
    allocationsData.value = response
  } catch (error) {
    console.error('Failed to load allocations:', error)
    allocationsData.value = { data: [] }
  } finally {
    pending.value = false
  }
}

await loadAllocations()

const refresh = () => loadAllocations()

const allocations = computed<Allocation[]>(() => allocationsData.value?.data ?? [])

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
  ip: z.string().trim().min(1, 'IP address or CIDR notation is required').refine((val) => {
    if (!val) return false
    const parts = val.split('/')
    if (parts.length === 1) {
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
      return ipRegex.test(val)
    }
    if (parts.length === 2) {
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
      const prefix = Number.parseInt(parts[1]!, 10)
      return ipRegex.test(parts[0]!) && Number.isFinite(prefix) && prefix >= 25 && prefix <= 32
    }
    return false
  }, 'Invalid IP address or CIDR notation (must be /25 to /32)'),
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
    if (!startRaw || !endRaw) {
      throw new Error('Invalid port range format')
    }
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
    const isCidr = event.data.ip.includes('/')
    const estimatedCount = isCidr 
      ? Math.pow(2, 32 - Number.parseInt(event.data.ip.split('/')[1]!, 10)) * ports.length
      : ports.length

    if (estimatedCount > 10000) {
      if (!confirm(`This will create approximately ${estimatedCount.toLocaleString()} allocations. Continue?`)) {
        isCreating.value = false
        return
      }
    }

    await $fetch(`/api/admin/nodes/${props.nodeId}/allocations`, {
      method: 'POST',
      body: {
        ip: event.data.ip,
        ports,
        ipAlias: event.data.ipAlias ? event.data.ipAlias : undefined,
      },
    })

    toast.add({
      title: 'Allocations created',
      description: `Created allocations for ${event.data.ip} with ${ports.length} port${ports.length === 1 ? '' : 's'}`,
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

function handleAliasBlur(allocation: Allocation, event: Event) {
  const target = event.target as HTMLInputElement
  const newAlias = target?.value || ''
  updateAlias(allocation, newAlias)
}

async function updateAlias(allocation: Allocation, newAlias: string) {
  updatingAlias.value = allocation.id
  try {
    await $fetch(`/api/admin/allocations/${allocation.id}`, {
      method: 'patch',
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
    await $fetch(`/api/admin/allocations/${allocation.id}`, {
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

const columns: TableColumn[] = [
  { key: 'ip', label: 'IP Address' },
  { key: 'ipAlias', label: 'IP Alias' },
  { key: 'port', label: 'Port' },
  { key: 'server', label: 'Assigned To' },
  { key: 'actions', label: '' },
]

const assignedCount = computed(() => allocations.value.filter(a => a.serverId !== null).length)
const unassignedCount = computed(() => allocations.value.filter(a => a.serverId === null).length)
</script>

<template>
  <div class="space-y-4">

    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex gap-2">
        <UButton :color="filter === 'all' ? 'primary' : 'neutral'" variant="soft" @click="filter = 'all'">
          All ({{ allocations.length }})
        </UButton>
        <UButton :color="filter === 'assigned' ? 'primary' : 'neutral'" variant="soft" @click="filter = 'assigned'">
          Assigned ({{ assignedCount }})
        </UButton>
        <UButton :color="filter === 'unassigned' ? 'primary' : 'neutral'" variant="soft" @click="filter = 'unassigned'">
          Unassigned ({{ unassignedCount }})
        </UButton>
      </div>

      <UButton icon="i-lucide-plus" color="primary" @click="showCreateModal = true">
        Create Allocations
      </UButton>
    </div>

    <UCard>
      <UTable :rows="paginatedAllocations" :columns="columns" :loading="pending">
        <template #ip-data="{ row }">
          <code class="text-sm">{{ (row as unknown as Allocation).ip }}</code>
        </template>

        <template #ipAlias-data="{ row }">
          <UInput 
            :model-value="(row as unknown as Allocation).ipAlias || ''" 
            placeholder="none" 
            size="sm"
            :loading="updatingAlias === (row as unknown as Allocation).id"
            @blur="handleAliasBlur(row as unknown as Allocation, $event)" 
          />
        </template>

        <template #port-data="{ row }">
          <code class="text-sm">{{ (row as unknown as Allocation).port }}</code>
        </template>

        <template #server-data="{ row }">
          <NuxtLink 
            v-if="(row as unknown as Allocation).serverId"
            :to="`/admin/servers/${(row as unknown as Allocation).serverId}`" 
            class="text-primary hover:underline"
          >
            Server
          </NuxtLink>
          <span v-else class="text-sm text-muted-foreground">-</span>
        </template>

        <template #actions-data="{ row }">
          <UButton 
            v-if="!(row as unknown as Allocation).serverId" 
            icon="i-lucide-trash-2" 
            color="error" 
            variant="ghost"
            size="sm" 
            @click="deleteAllocation(row as unknown as Allocation)" 
          />
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
          id="create-allocation-form"
          :schema="createSchema"
          :state="createForm"
          class="space-y-4"
          :disabled="isCreating"
          :validate-on="['input']"
          @submit="createAllocations"
        >
          <UAlert icon="i-lucide-info">
            <template #title>Bulk Creation</template>
            <template #description>
              <ul class="list-disc list-inside space-y-1 text-sm">
                <li>IP addresses: Use CIDR notation (e.g., <code>192.168.1.0/24</code>) to create multiple IPs, or a single IP (e.g., <code>192.168.1.1</code>)</li>
                <li>Ports: Use a range (e.g., <code>25565-25665</code>) or comma-separated list (e.g., <code>25565,25566,25567</code>)</li>
                <li>CIDR ranges must be between /25 and /32</li>
              </ul>
            </template>
          </UAlert>

          <UFormField label="IP Address or CIDR" name="ip" required>
            <UInput v-model="createForm.ip" placeholder="192.168.1.0/24 or 192.168.1.1" />
            <template #help>
              Single IP address (e.g., 192.168.1.1) or CIDR notation (e.g., 192.168.1.0/24) to create multiple IPs
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
            <UButton 
              type="submit" 
              form="create-allocation-form"
              color="primary" 
              :loading="isCreating" 
              :disabled="isCreating"
            >
              Create Allocations
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>
