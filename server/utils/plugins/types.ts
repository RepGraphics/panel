import type { ResolvedPluginManifest } from '#shared/plugins/types';

export interface XyraPluginLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}

export interface XyraPluginContext {
  plugin: ResolvedPluginManifest;
  nitroApp: unknown;
  log: XyraPluginLogger;
  emitHook: <TPayload = unknown>(name: string, payload?: TPayload) => Promise<void>;
}

export interface XyraPluginHookContext extends XyraPluginContext {}

export type XyraPluginSetupHandler = (context: XyraPluginContext) => void | Promise<void>;
export type XyraPluginHookHandler<TPayload = unknown> = (
  payload: TPayload,
  context: XyraPluginHookContext,
) => void | Promise<void>;

export interface XyraServerPluginObject {
  setup?: XyraPluginSetupHandler;
  hooks?: Record<string, XyraPluginHookHandler>;
}

export type XyraServerPlugin = XyraServerPluginObject | XyraPluginSetupHandler;

export function defineXyraPlugin(plugin: XyraServerPluginObject): XyraServerPluginObject {
  return plugin;
}
