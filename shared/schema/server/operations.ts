import { z } from 'zod'

export const serverCommandSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1, 'Command is required')
    .max(2048, 'Command is too long'),
})

export type ServerCommandInput = z.infer<typeof serverCommandSchema>

export const createServerDatabaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Database name is required')
    .max(100, 'Database name must be under 100 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Database name can only contain letters, numbers, and underscores'),
  remote: z
    .string()
    .trim()
    .min(1, 'Remote host is required')
    .max(255, 'Remote value is too long'),
})

export const createDatabaseSchema = createServerDatabaseSchema
export type CreateServerDatabaseInput = z.infer<typeof createServerDatabaseSchema>

export const updateScheduleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Schedule name is required')
    .max(255, 'Schedule name is too long')
    .optional(),
  cron: z
    .string()
    .trim()
    .min(1, 'Cron expression is required')
    .max(255, 'Cron expression is too long')
    .optional(),
  action: z
    .string()
    .trim()
    .max(255, 'Action is too long')
    .optional(),
  enabled: z.boolean().optional(),
})

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>

export const createTaskSchema = z.object({
  action: z
    .string()
    .trim()
    .min(1, 'Action is required')
    .max(255, 'Action is too long'),
  payload: z
    .string()
    .trim()
    .min(1, 'Payload is required')
    .max(10000, 'Payload is too long'),
  time_offset: z
    .number()
    .int()
    .min(0, 'Time offset cannot be negative')
    .max(3600, 'Time offset cannot exceed 3600 seconds')
    .optional()
    .default(0),
  continue_on_failure: z.boolean().optional().default(false),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>

export const updateTaskSchema = z.object({
  action: z
    .string()
    .trim()
    .min(1, 'Action is required')
    .max(255, 'Action is too long')
    .optional(),
  payload: z
    .string()
    .trim()
    .min(1, 'Payload is required')
    .max(10000, 'Payload is too long')
    .optional(),
  time_offset: z
    .number()
    .int()
    .min(0, 'Time offset cannot be negative')
    .max(3600, 'Time offset cannot exceed 3600 seconds')
    .optional(),
  continue_on_failure: z.boolean().optional(),
})

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

export const updateDockerImageSchema = z.object({
  dockerImage: z.string().min(1, 'Docker image is required').max(255, 'Docker image is too long'),
})

export const attachMountSchema = z.object({
  mountId: z.uuid('Mount ID must be a valid UUID'),
})

export type UpdateDockerImageInput = z.infer<typeof updateDockerImageSchema>
export type AttachMountInput = z.infer<typeof attachMountSchema>

