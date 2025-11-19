/* 
Customizing your theme can be done from the app.config.ts file. We utilize NuxtUI for our components which can be overridden here.
For more information, visit https://ui.nuxt.com/docs/getting-started/theme/components#global-config
*/
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      secondary: 'purple',
      neutral: 'zinc'
    }
  }
})
