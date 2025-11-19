import { z } from 'zod'
import {
  accountProfileUpdateSchema,
  accountPasswordUpdateSchema,
} from '#shared/schema/account'

export const createApiKeySchema = z.object({
  memo: z.string().min(1, 'Description is required').max(500, 'Description too long'),
  allowedIps: z.array(z.string().ip()).optional(),
  expiresAt: z.string().datetime().optional(),
})

export const updateProfileSchema = accountProfileUpdateSchema

export const updatePasswordSchema = accountPasswordUpdateSchema

export const updateEmailSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
})

export const createSshKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  publicKey: z.string().min(1, 'Public key is required'),
})

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>
export type CreateSshKeyInput = z.infer<typeof createSshKeySchema>
