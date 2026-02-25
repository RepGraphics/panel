import { describe, expect, it } from 'vitest';
import { buildPluginScopeSettingKey, isScopeEnabledForEgg } from '../../../server/utils/plugins/scope';

describe('server/utils/plugins/scope', () => {
  it('builds deterministic setting keys', () => {
    expect(buildPluginScopeSettingKey('player-listing')).toBe('plugins:scope:player-listing');
  });

  it('enables global scopes for any egg', () => {
    expect(isScopeEnabledForEgg({ mode: 'global', eggIds: [] }, 'egg-1')).toBe(true);
    expect(isScopeEnabledForEgg({ mode: 'global', eggIds: [] }, null)).toBe(true);
  });

  it('matches egg-scoped plugins to selected eggs only', () => {
    const scope = { mode: 'eggs' as const, eggIds: ['egg-a', 'egg-b'] };

    expect(isScopeEnabledForEgg(scope, 'egg-a')).toBe(true);
    expect(isScopeEnabledForEgg(scope, 'egg-c')).toBe(false);
    expect(isScopeEnabledForEgg(scope, null)).toBe(false);
  });
});
