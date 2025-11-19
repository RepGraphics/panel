import { z } from 'zod'

export const localeEnumValues = ['en', 'de', 'fr', 'es'] as const
export const timezoneEnumValues = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
] as const

const nullableUrl = z.preprocess(
  value => {
    if (value === '' || value === undefined)
      return null

    return value
  },
  z.string().trim().url('Provide a valid logo URL').nullable(),
)

const adminGeneralSettingsBaseSchema = z.object({
  name: z.string().trim().min(2, 'Panel name must be at least 2 characters'),
  url: z.string().trim().url('Enter a valid URL'),
  locale: z.enum(localeEnumValues, { required_error: 'Select a default language' }),
  timezone: z.enum(timezoneEnumValues, { required_error: 'Select a timezone' }),
  brandText: z.string().trim().max(80, 'Brand text must be 80 characters or less'),
  showBrandText: z.boolean(),
  showBrandLogo: z.boolean(),
  brandLogoUrl: nullableUrl,
})

export const adminGeneralSettingsFormSchema = adminGeneralSettingsBaseSchema

export const adminGeneralSettingsUpdateSchema = adminGeneralSettingsBaseSchema.partial()

export type AdminGeneralSettingsFormInput = z.infer<typeof adminGeneralSettingsFormSchema>
export type AdminGeneralSettingsUpdateInput = z.infer<typeof adminGeneralSettingsUpdateSchema>

const adminSecuritySettingsBaseSchema = z.object({
  enforceTwoFactor: z.boolean(),
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().trim().max(500, 'Maintenance message must be 500 characters or fewer'),
  announcementEnabled: z.boolean(),
  announcementMessage: z.string().trim().max(500, 'Announcement message must be 500 characters or fewer'),
})

function validateSecuritySettings(data: Partial<z.infer<typeof adminSecuritySettingsBaseSchema>>, ctx: z.RefinementCtx) {
  if (data.maintenanceMode && (data.maintenanceMessage ?? '').length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maintenanceMessage'],
      message: 'Provide a maintenance message to show users.',
    })
  }

  if (data.announcementEnabled && (data.announcementMessage ?? '').length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['announcementMessage'],
      message: 'Write the announcement content before enabling the banner.',
    })
  }
}

export const adminSecuritySettingsFormSchema = adminSecuritySettingsBaseSchema.superRefine((data, ctx) => {
  validateSecuritySettings(data, ctx)
})

export const adminSecuritySettingsUpdateSchema = adminSecuritySettingsBaseSchema.partial().superRefine((data, ctx) => {
  validateSecuritySettings(data, ctx)
})

export type AdminSecuritySettingsFormInput = z.infer<typeof adminSecuritySettingsFormSchema>
export type AdminSecuritySettingsUpdateInput = z.infer<typeof adminSecuritySettingsUpdateSchema>

export const adminMailSettingsFormSchema = z.object({
  driver: z.enum(['smtp', 'sendmail', 'mailgun'], { required_error: 'Select a mail driver' }),
  host: z.string().trim().optional(),
  port: z.string().trim().optional(),
  username: z.string().trim().optional(),
  password: z.string().trim().optional(),
  encryption: z.enum(['tls', 'ssl', 'none']).optional(),
  fromAddress: z.string().trim().email('Provide a valid From address').optional(),
  fromName: z.string().trim().optional(),
})

export const adminMailSettingsUpdateSchema = adminMailSettingsFormSchema.partial()

export type AdminMailSettingsFormInput = z.infer<typeof adminMailSettingsFormSchema>
export type AdminMailSettingsUpdateInput = z.infer<typeof adminMailSettingsUpdateSchema>

export const adminAdvancedSettingsFormSchema = z.object({
  telemetryEnabled: z.boolean(),
  debugMode: z.boolean(),
  recaptchaEnabled: z.boolean(),
  recaptchaSiteKey: z.string().trim().optional(),
  recaptchaSecretKey: z.string().trim().optional(),
  sessionTimeoutMinutes: z.number({ invalid_type_error: 'Session timeout must be a number' }).int().positive(),
  queueConcurrency: z.number({ invalid_type_error: 'Queue concurrency must be a number' }).int().positive(),
  queueRetryLimit: z.number({ invalid_type_error: 'Queue retry limit must be a number' }).int().min(0),
})

export const adminAdvancedSettingsUpdateSchema = adminAdvancedSettingsFormSchema.partial()

export type AdminAdvancedSettingsFormInput = z.infer<typeof adminAdvancedSettingsFormSchema>
export type AdminAdvancedSettingsUpdateInput = z.infer<typeof adminAdvancedSettingsUpdateSchema>
