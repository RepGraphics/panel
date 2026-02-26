import type { AdminNavItem } from '#shared/types/admin';
import type { PluginDiscoveryError, PluginSlotContribution } from '#shared/plugins/types';

export type PluginRenderScopeMode = 'global' | 'eggs';

export interface PluginRenderScope {
  mode: PluginRenderScopeMode;
  eggIds: string[];
}

export interface PluginScopeEggOption {
  id: string;
  name: string;
  nestName: string | null;
}

export interface PluginScopeSummary {
  scopes: Record<string, PluginRenderScope>;
  eggs: PluginScopeEggOption[];
}

export interface PluginNavigationContribution extends AdminNavItem {
  pluginId: string;
}

export interface PluginUiSlotContribution extends PluginSlotContribution {
  pluginId: string;
}

export interface PluginRuntimeSummaryItem {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  website?: string;
  enabled: boolean;
  loaded: boolean;
  manifestPath: string;
  sourceDir: string;
  serverEntryPath?: string;
  moduleEntryPath?: string;
  nuxtLayerPath?: string;
  migrationsPath?: string;
  hooks: string[];
  errors: string[];
  contributions: {
    adminNavigation: PluginNavigationContribution[];
    dashboardNavigation: PluginNavigationContribution[];
    serverNavigation: PluginNavigationContribution[];
    uiSlots: PluginUiSlotContribution[];
  };
}

export interface PluginRuntimeSummary {
  initialized: boolean;
  plugins: PluginRuntimeSummaryItem[];
  discoveryErrors: PluginDiscoveryError[];
}

export interface PluginClientContributions {
  adminNavigation: PluginNavigationContribution[];
  dashboardNavigation: PluginNavigationContribution[];
  serverNavigation: PluginNavigationContribution[];
  uiSlots: PluginUiSlotContribution[];
}
