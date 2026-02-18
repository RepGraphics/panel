import { requireAdmin } from '#server/utils/security'
import { SETTINGS_KEYS, getSettingWithDefault } from '#server/utils/settings'
import { recordAuditEventFromRequest } from '#server/utils/audit'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  const data = {
    driver: await getSettingWithDefault(SETTINGS_KEYS.MAIL_DRIVER, 'smtp'),
    service: await getSettingWithDefault(SETTINGS_KEYS.MAIL_SERVICE, ''),
    host: await getSettingWithDefault(SETTINGS_KEYS.MAIL_HOST, 'localhost'),
    port: await getSettingWithDefault(SETTINGS_KEYS.MAIL_PORT, '587'),
    username: await getSettingWithDefault(SETTINGS_KEYS.MAIL_USERNAME, ''),
    password: await getSettingWithDefault(SETTINGS_KEYS.MAIL_PASSWORD, ''),
    encryption: await getSettingWithDefault(SETTINGS_KEYS.MAIL_ENCRYPTION, 'tls'),
    fromAddress: await getSettingWithDefault(SETTINGS_KEYS.MAIL_FROM_ADDRESS, 'noreply@xyrapanel.local'),
    fromName: await getSettingWithDefault(SETTINGS_KEYS.MAIL_FROM_NAME, useRuntimeConfig().public.appName || 'XyraPanel'),
  }

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.settings.mail.viewed',
    targetType: 'settings',
  })

  return {
    data,
  }
})
