# Plugin System

XyraPanel has an experimental plugin system.

## What A Plugin Can Do

- Load server-side logic at startup (`entry.server`).
- Register a Nuxt module at startup (`entry.module`).
- Register runtime hooks (`panel:ready`, `request:before`, `request:after`).
- Extend the frontend using a Nuxt layer (`entry.nuxtLayer`).
- Add admin navigation items (`contributions.adminNavigation`).
- Add client dashboard navigation items (`contributions.dashboardNavigation`).
- Add server sidebar navigation items (`contributions.serverNavigation`).
- Inject components into named UI slot outlets (`contributions.uiSlots`).
- Use per-plugin render scope settings in Admin (`global` or selected eggs).

## Quick Start

### Plugin System Version

The Admin Plugins page version badge is read from `package.json`:

```json
{
  "xyra": {
    "pluginSystemVersion": "0.1 Alpha"
  }
}
```

Update this value when you want to bump the plugin system version shown in the UI.

### Install via CLI

Use the built-in installer instead of manually copying files:

```bash
# list installed plugins
xyra plugins list

# install from local folder
xyra plugins install ./my-plugin

# install from git
xyra plugins install https://github.com/acme/xyra-plugin-example

# if plugin.json is nested in the repo
xyra plugins install https://github.com/acme/plugin-monorepo --manifest packages/my-plugin

# remove plugin
xyra plugins remove my-plugin
```

Notes:

- The installer expects a `plugin.json` manifest in the source root (or the folder passed via `--manifest`).
- Use `--force` to overwrite an existing plugin directory.
- After installing or removing, refresh `/admin/plugins` to reload runtime state.
- If a plugin includes `entry.nuxtLayer` or `entry.module`, rebuild/restart behavior still applies:
  - Dev mode: layer/module changes can be picked up after a dev reload.
  - Production: Nuxt layer/module changes require rebuilding the panel, then restarting.
- Each plugin now has a default **global** render scope in `/admin/plugins`.
  - Switch to **Specific eggs** to limit where server-side plugin UI renders.
  - This scope controls server plugin contributions (for example server sidebar items).

### 1. Create a plugin folder

```text
extensions/
  acme-tools/
    plugin.json
    dist/
      server.mjs
    migrations/
      001_initial.sql
      001_initial.down.sql
    modules/
      xyra.ts
    ui/
      app/
        components/
        pages/
```

### 2. Add `plugin.json`

```json
{
  "id": "acme-tools",
  "name": "Acme Tools",
  "version": "1.0.0",
  "compatibility": "0.1 Alpha",
  "description": "Adds internal tooling",
  "author": "Acme Dev Team",
  "website": "https://example.com/acme-tools",
  "enabled": true,
  "entry": {
    "server": "./dist/server.mjs",
    "module": "./modules/xyra.ts",
    "nuxtLayer": "./ui",
    "migrations": "./migrations"
  },
  "contributions": {
    "adminNavigation": [
      {
        "id": "acme-tools-dashboard",
        "label": "Acme Tools",
        "to": "/admin/acme-tools",
        "icon": "i-lucide-puzzle",
        "order": 450,
        "permission": "admin.settings.read"
      }
    ],
    "dashboardNavigation": [
      {
        "id": "acme-tools-client",
        "label": "Acme Tools",
        "to": "/acme-tools",
        "icon": "i-lucide-puzzle",
        "order": 320
      }
    ],
    "serverNavigation": [
      {
        "id": "acme-tools-server",
        "label": "Acme Tools",
        "to": "acme-tools",
        "icon": "i-lucide-puzzle",
        "order": 450
      }
    ],
    "uiSlots": [
      {
        "slot": "admin.layout.after-content",
        "component": "AcmeAdminBanner",
        "order": 100
      }
    ]
  }
}
```

### 3. Add a server entry (optional)

`dist/server.mjs`:

```js
export default {
  async setup(ctx) {
    ctx.log.info('acme-tools loaded', { version: ctx.plugin.version });
  },
  hooks: {
    'panel:ready': async (payload, ctx) => {
      ctx.log.info('panel ready', payload);
    },
    'request:after': async (payload, ctx) => {
      if (payload.statusCode >= 500) {
        ctx.log.warn('request failed', { statusCode: payload.statusCode });
      }
    },
  },
};
```

### 4. Add frontend files (optional)

If using `entry.nuxtLayer`, place components/pages in the layer:

```text
extensions/acme-tools/ui/app/components/AcmeAdminBanner.vue
extensions/acme-tools/ui/app/pages/admin/acme-tools.vue
```

### 5. Add a Nuxt module entry (optional)

`modules/xyra.ts`:

```ts
import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit';

export default defineNuxtModule({
  meta: {
    name: 'acme-tools',
  },
  setup() {
    const { resolve } = createResolver(import.meta.url);
    addPlugin(resolve('../runtime/plugins/acme-tools'));
  },
});
```

Nuxt module entries are loaded into the panel `modules` config automatically when `entry.module` is set.

### 6. Restart and verify

- Restart `pnpm dev` after creating/changing plugin manifests or layer paths.
- Check runtime state at `/admin/plugins`.

## Manifest Reference

`plugin.json` fields:

| Field                           | Type      | Required | Notes                                              |
| ------------------------------- | --------- | -------- | -------------------------------------------------- |
| `id`                            | `string`  | yes      | Must match `^[a-z0-9][a-z0-9._-]*$` and be unique. |
| `name`                          | `string`  | yes      | Display name in admin/runtime summaries.           |
| `version`                       | `string`  | yes      | Free-form version string.                          |
| `compatibility`                 | `string`  | yes      | Must exactly match panel plugin system version.    |
| `description`                   | `string`  | yes      | Plugin description metadata.                       |
| `author`                        | `string`  | yes      | Plugin author metadata.                            |
| `website`                       | `string`  | yes      | Plugin website metadata.                           |
| `enabled`                       | `boolean` | no       | Defaults to enabled when omitted.                  |
| `entry.server`                  | `string`  | no       | Relative file path inside plugin dir.              |
| `entry.module`                  | `string`  | no       | Relative Nuxt module file path inside plugin dir.  |
| `entry.nuxtLayer`               | `string`  | no       | Relative directory path inside plugin dir.         |
| `entry.migrations`              | `string`  | no       | Relative directory path containing `.sql` files.   |
| `contributions.adminNavigation` | `array`   | no       | Extra admin nav entries.                           |
| `contributions.dashboardNavigation` | `array`   | no       | Extra client dashboard sidebar entries.            |
| `contributions.serverNavigation` | `array`   | no       | Extra server sidebar entries.                      |
| `contributions.uiSlots`         | `array`   | no       | UI slot injections.                                |

Validation and safety rules:

- `entry.server`, `entry.module`, `entry.nuxtLayer`, and `entry.migrations` must be relative paths.
- Paths cannot escape the plugin directory.
- Missing paths are reported as discovery errors.
- `compatibility` must match `package.json` -> `xyra.pluginSystemVersion`.
- `entry.module` must resolve to a file.
- `entry.nuxtLayer` must resolve to a directory.
- `entry.migrations` must resolve to a directory.

## Plugin Migrations

Plugins can ship SQL migrations by setting `entry.migrations` to a directory.

Behavior:

- All `*.sql` files under the directory (including subdirectories) are sorted by relative path and applied in order.
  - Files ending in `.down.sql` are reserved for uninstall rollback and are not applied on install/startup.
- Migrations are tracked in `public.xyra_plugin_migrations` by `plugin_id + migration_path + checksum`.
- Already applied files are skipped.
- Editing an already-applied migration file causes a checksum mismatch error; add a new migration file instead.
- Migrations run during plugin runtime initialization/reload (startup, install, enable, or runtime reload).
- Uninstall rollback:
  - For each tracked migration `name.sql`, uninstall expects a rollback file `name.down.sql` in the same relative path.
  - Rollbacks execute in reverse apply order.
  - If a rollback file is missing, uninstall continues and returns a warning that related database entries were not removed.

## Runtime API

A server plugin can export:

- A default function `(ctx) => {}`.
- A default object with `setup` and `hooks`.

Context shape:

```ts
{
  plugin,      // resolved manifest + paths
  nitroApp,    // Nitro app instance (opaque)
  log,         // info/warn/error/debug prefixed logger
  emitHook,    // emit a plugin hook manually
}
```

Hook handler shape:

```ts
async function hook(payload, ctx) {}
```

Built-in emitted hooks:

- `panel:ready`
  - payload: `{ loaded: number, failed: number }`
- `request:before`
  - payload: `{ event }`
- `request:after`
  - payload: `{ event, statusCode: number }`

## Frontend Contributions

### Admin navigation

Each contribution entry supports:

- `id`, `label`, `to`, `icon`, `order`
- `permission`: string or string array (array means any-of)
- `children`: nested items

Notes:

- Runtime prefixes ids to avoid collisions: `plugin:<pluginId>:<id>`.
- Admin users bypass permission filtering.

### Server navigation

`contributions.serverNavigation` uses the same item shape as admin navigation (`id`, `label`, `to`, `icon`, `order`, optional `permission` and `children`).

Path handling in the server sidebar:

- Absolute paths are used as-is (example: `/server/{id}/players`).
- Relative paths are resolved under the current server (example: `players` -> `/server/<id>/players`).
- Dynamic server id placeholders are supported: `{id}`, `[id]`, and `:id`.

### Dashboard navigation

`contributions.dashboardNavigation` uses the same item shape as admin navigation (`id`, `label`, `to`, `icon`, `order`, optional `permission` and `children`).

Path handling in the dashboard sidebar:

- Absolute paths are supported directly (example: `/acme-tools`).
- Relative paths are normalized to root paths (example: `acme-tools` -> `/acme-tools`).

### UI slots

Each contribution entry supports:

- `slot` (string, required)
- `component` (string, required)
- `order` (number, optional, default `500`)
- `permission` (string or string array)
- `props` (object)

Current slot outlets:

- `app.wrapper.before`
- `app.wrapper.after`
- `admin.wrapper.before`
- `admin.wrapper.after`
- `admin.layout.before-navbar`
- `admin.layout.after-navbar`
- `admin.layout.before-content`
- `admin.layout.after-content`
- `admin.dashboard.before-content`
- `admin.dashboard.after-content`
- `client.wrapper.before`
- `client.wrapper.after`
- `client.layout.before-navbar`
- `client.layout.after-navbar`
- `client.layout.before-content`
- `client.layout.after-content`
- `client.dashboard.before-content`
- `client.dashboard.after-content`
- `server.wrapper.before`
- `server.wrapper.after`
- `server.layout.before-navbar`
- `server.layout.after-navbar`
- `server.layout.before-content`
- `server.layout.after-content`
- `server.console.power-buttons.before`
- `server.console.power-buttons.after`
- `server.console.between-terminal-and-stats`
- `server.console.after-stats`
- `server.console.stats-card.before`
- `server.console.stats-card.after`
- `server.activity.table.before`
- `server.activity.table.after`
- `server.files.create-buttons.before`
- `server.files.create-buttons.after`
- `server.startup.command.before`
- `server.settings.top`
- `server.settings.bottom`

The `component` must be resolvable by the Nuxt app (typically via the plugin Nuxt layer).

Wrapper slots are intended for global concerns. A plugin component rendered in wrapper slots can call `useHead()` to register layout-level CSS/JS and metadata.

## Environment

Plugin discovery uses:

- `XYRA_PLUGIN_DIRS` (comma-separated plugin roots; each entry can be a parent directory of plugins or a direct plugin folder path, absolute or relative to panel root)
- fallback: `XYRA_PLUGINS_DIR`
- `XYRA_PLUGIN_INSTALL_DIR` (optional installer destination root; defaults to `extensions`)

Default:

```dotenv
XYRA_PLUGIN_DIRS="extensions"
```

Migration connection retry tuning:

```dotenv
XYRA_PLUGIN_MIGRATION_CONNECT_RETRIES="3" # retries after initial attempt for pg 53300 (too many clients)
XYRA_PLUGIN_MIGRATION_CONNECT_RETRY_DELAY_MS="250" # base retry delay in ms (linear backoff)
```

Production note:

```dotenv
# Nuxt layer/module plugin changes require a production rebuild.
# Example: pnpm build && restart your panel process manager.
```

## Inspection APIs

- `GET /api/admin/plugins` (admin-only runtime summary; requires `admin.settings.read` for API keys)
- `GET /api/admin/plugins/scopes` (admin-only plugin scope + available eggs; requires `admin.settings.read` for API keys)
- `PATCH /api/admin/plugins/:id/scope` (admin-only; set plugin scope to `global` or `eggs`; requires `admin.settings.write` for API keys)
- `PATCH /api/admin/plugins/:id/state` (admin-only; enable/disable a plugin; requires `admin.settings.write` for API keys)
- `DELETE /api/admin/plugins/:id` (admin-only; uninstall plugin files and remove scope settings; requires `admin.settings.write` for API keys)
- `GET /api/plugins/contributions` (authenticated, permission-filtered contributions; pass `serverId` to apply egg scope filtering)

## Troubleshooting

### Plugin does not appear in `/admin/plugins`

- Confirm manifest location is either `extensions/<id>/plugin.json` or `<custom-path>/plugin.json`.
- Confirm `XYRA_PLUGIN_DIRS` includes either the plugin parent directory or the direct plugin folder path.
- Check manifest JSON syntax.

### Plugin discovered but not loaded

- Check `entry.server` exists and is valid ESM.
- Ensure export is either a function or an object with `setup`/`hooks`.
- Read plugin errors in `/admin/plugins` and server logs.

### Slot component does not render

- Confirm `entry.nuxtLayer` points to a valid Nuxt layer directory.
- Confirm component name matches what Nuxt resolves globally.
- Restart dev server after manifest/layer changes.

### Module entry does not execute

- Confirm `entry.module` points to a file (example: `./modules/xyra.ts`).
- Confirm module default export uses `defineNuxtModule(...)`.
- Restart dev server after adding/changing `entry.module`.

### Navigation item not visible

- Check `permission` value matches actual session permissions.
- Check user role and ACL context.

## Security Notes

Plugins run trusted code on your server process. There is no sandbox or signature verification yet. Only install plugins you trust.
