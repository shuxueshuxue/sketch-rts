import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.resetModules();
});

it('loads the approved frozen manifest on rules 2', async () => {
  const { frozenPolicyManifest } = await import('./bootstrap_1-planner');
  expect(frozenPolicyManifest.rulesVersion).toBe(2);
});

it.each([1, 3, undefined])('rejects frozen rules %s before a planner or match can run', async rulesVersion => {
  vi.resetModules();
  vi.doMock('node:fs', async importOriginal => {
    const fs = await importOriginal<typeof import('node:fs')>();
    return { ...fs, readFileSync: (path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
      if (String(path).endsWith('/docs/engineering/bootstrap_1/frozen-policy.json')) {
        return JSON.stringify({ revision: 'unused', files: {}, rulesVersion });
      }
      return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args);
    } };
  });
  await expect(import('./bootstrap_1-planner')).rejects.toThrow(/bootstrap_1 frozen policy manifest.*Cross-version simulation is not supported/);
});
