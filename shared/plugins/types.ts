import type { AdminNavItem } from '#shared/types/admin';

export const CORE_PLUGIN_UI_SLOTS = [
  'app.wrapper.before',
  'app.wrapper.after',
  'admin.wrapper.before',
  'admin.wrapper.after',
  'admin.layout.before-navbar',
  'admin.layout.after-navbar',
  'admin.layout.before-content',
  'admin.layout.after-content',
  'admin.dashboard.before-content',
  'admin.dashboard.after-content',
  'client.wrapper.before',
  'client.wrapper.after',
  'client.layout.before-navbar',
  'client.layout.after-navbar',
  'client.layout.before-content',
  'client.layout.after-content',
  'client.dashboard.before-content',
  'client.dashboard.after-content',
  'server.wrapper.before',
  'server.wrapper.after',
  'server.layout.before-navbar',
  'server.layout.after-navbar',
  'server.layout.before-content',
  'server.layout.after-content',
] as const;

export type CorePluginUiSlotName = (typeof CORE_PLUGIN_UI_SLOTS)[number];
export type PluginUiSlotName = CorePluginUiSlotName | (string & {});

export interface PluginEntryManifest {
  server?: string;
  module?: string;
  nuxtLayer?: string;
}

export interface PluginSlotContribution {
  slot: PluginUiSlotName;
  component: string;
  order?: number;
  permission?: string | string[];
  props?: Record<string, unknown>;
}

export interface PluginContributionsManifest {
  adminNavigation?: AdminNavItem[];
  dashboardNavigation?: AdminNavItem[];
  serverNavigation?: AdminNavItem[];
  uiSlots?: PluginSlotContribution[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  website?: string;
  enabled?: boolean;
  entry?: PluginEntryManifest;
  contributions?: PluginContributionsManifest;
}

export interface ResolvedPluginManifest extends PluginManifest {
  sourceDir: string;
  manifestPath: string;
  serverEntryPath?: string;
  moduleEntryPath?: string;
  nuxtLayerPath?: string;
}

export interface PluginDiscoveryError {
  pluginId?: string;
  manifestPath?: string;
  message: string;
}

export interface PluginDiscoveryResult {
  plugins: ResolvedPluginManifest[];
  errors: PluginDiscoveryError[];
}

export interface PluginDiscoveryOptions {
  rootDir?: string;
  pluginDirs?: string[];
}
