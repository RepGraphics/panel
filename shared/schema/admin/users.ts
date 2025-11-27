import { z } from 'zod'

export const createUserSchema = z.object({
  username: z.string().min(1).max(255).optional(),
  email: z.string().min(1).max(255).refine((val) => z.email().safeParse(val).success, 'Invalid email format'),
  password: z.string().min(8).max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  nameFirst: z.string().max(255).optional(),
  nameLast: z.string().max(255).optional(),
  language: z.string().max(10).optional(),
  rootAdmin: z.union([z.boolean(), z.string()]).optional(),
  role: z.enum(['admin', 'user']).default('user'),
})

export const updateUserSchema = z.object({
  email: z.email().optional(),
  username: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['user', 'admin']).optional(),
})

export const emailVerificationActionSchema = z.object({
  action: z.enum(['mark-verified', 'mark-unverified', 'resend-link']),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type EmailVerificationActionInput = z.infer<typeof emailVerificationActionSchema>

