import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_PLUGIN_UI_SLOTS } from '../../../shared/plugins/types';

const PLUGIN_SLOT_PREFIX_PATTERN = /^(app|admin|client|server)\./;
const PLUGIN_OUTLET_NAME_PATTERN = /<PluginOutlet\b[\s\S]*?\bname="([^"]+)"/g;

function collectVueFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectVueFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectDeclaredPluginSlots(): Set<string> {
  const appRoot = resolve(process.cwd(), 'app');
  const vueFiles = collectVueFiles(appRoot);
  const slots = new Set<string>();

  for (const filePath of vueFiles) {
    const content = readFileSync(filePath, 'utf8');
    const matches = content.matchAll(PLUGIN_OUTLET_NAME_PATTERN);

    for (const match of matches) {
      const slotName = match[1]?.trim();
      if (slotName && PLUGIN_SLOT_PREFIX_PATTERN.test(slotName)) {
        slots.add(slotName);
      }
    }
  }

  return slots;
}

describe('plugin ui slots', () => {
  it('keeps the slot registry in sync with mounted PluginOutlet names', () => {
    const declared = collectDeclaredPluginSlots();
    const registry = new Set<string>(CORE_PLUGIN_UI_SLOTS);

    const missingOutlets = CORE_PLUGIN_UI_SLOTS.filter((slot) => !declared.has(slot));
    const unregisteredOutlets = Array.from(declared).filter((slot) => !registry.has(slot));

    expect(missingOutlets).toEqual([]);
    expect(unregisteredOutlets).toEqual([]);
  });
});
