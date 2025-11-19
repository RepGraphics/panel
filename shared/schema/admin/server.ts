import { z } from 'zod'

const threadsSchema = z
  .union([
    z.string().trim().min(1).max(191),
    z.literal('').transform(() => null),
    z.null(),
  ])
  .transform(value => (value === '' ? null : value))
  .nullable()

export const serverBuildSchema = z.object({
  cpu: z
    .number({ invalid_type_error: 'CPU limit must be a number' })
    .min(0, 'CPU limit cannot be negative')
    .optional(),
  memory: z
    .number({ invalid_type_error: 'Memory limit must be a number' })
    .min(0, 'Memory limit cannot be negative')
    .optional(),
  swap: z
    .number({ invalid_type_error: 'Swap must be a number' })
    .min(-1, 'Swap must be -1 or greater')
    .optional(),
  disk: z
    .number({ invalid_type_error: 'Disk limit must be a number' })
    .min(0, 'Disk limit cannot be negative')
    .optional(),
  io: z
    .number({ invalid_type_error: 'Block I/O must be a number' })
    .min(10, 'Block I/O must be at least 10')
    .max(1000, 'Block I/O cannot exceed 1000')
    .optional(),
  threads: threadsSchema.optional(),
  oomDisabled: z.boolean().optional(),
  databaseLimit: z.number().int().min(0).optional(),
  allocationLimit: z.number().int().min(0).optional(),
  backupLimit: z.number().int().min(0).optional(),
})

export const serverBuildFormSchema = serverBuildSchema.required({
  cpu: true,
  memory: true,
  swap: true,
  disk: true,
  io: true,
})

export type ServerBuildInput = z.infer<typeof serverBuildSchema>

export const serverStartupSchema = z.object({
  startup: z
    .string()
    .trim()
    .min(1, 'Startup command is required')
    .max(2048, 'Startup command is too long'),
  dockerImage: z
    .string()
    .trim()
    .min(1, 'Docker image is required')
    .max(255, 'Docker image is too long'),
  environment: z.record(z.string()),
})

export type ServerStartupInput = z.infer<typeof serverStartupSchema>

export const serverDatabaseCreateSchema = z.object({
  database: z
    .string()
    .trim()
    .min(1, 'Database name is required')
    .max(100, 'Database name must be under 100 characters'),
  remote: z
    .string()
    .trim()
    .min(1, 'Remote host is required')
    .max(255, 'Remote value is too long'),
})

export type ServerDatabaseCreateInput = z.infer<typeof serverDatabaseCreateSchema>
