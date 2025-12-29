import { SETTINGS_KEYS, getSetting } from '~~/server/utils/settings'

export default defineEventHandler(() => {
  const showLogoSetting = getSetting(SETTINGS_KEYS.BRAND_SHOW_LOGO)
  const logoPath = getSetting(SETTINGS_KEYS.BRAND_LOGO_PATH)

  return {
    showBrandLogo: showLogoSetting ? showLogoSetting === 'true' : false,
    brandLogoUrl: logoPath ?? null,
  }
})
