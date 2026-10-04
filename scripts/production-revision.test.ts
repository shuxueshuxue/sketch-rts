import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('production promotion against a linear-history remote', () => {
  it('publishes the exact main tree without its merge commits and rejects stale revisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rts-promotion-'));
    const bare = join(dir, 'remote.git');
    const work = join(dir, 'work');
    const script = resolve('scripts/resolve-production-revision.sh');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' });
      execFileSync('git', ['clone', bare, work], { stdio: 'ignore' });
      git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
      git('checkout', '-b', 'main');
      writeFileSync(join(work, 'base.txt'), 'base');
      git('add', '.'); git('commit', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      git('branch', 'production'); git('push', 'origin', 'main', 'production');
      git('checkout', '-b', 'feature');
      writeFileSync(join(work, 'feature.txt'), 'feature');
      git('add', '.'); git('commit', '-m', 'feature');
      git('checkout', 'main');
      writeFileSync(join(work, 'main.txt'), 'main');
      git('add', '.'); git('commit', '-m', 'main change');
      git('merge', '--no-ff', 'feature', '-m', 'merge feature');
      git('push', 'origin', 'main');
      const main = git('rev-parse', 'HEAD');
      // Simulate GitHub's production branch protection, without weakening it.
      const hook = join(bare, 'hooks/pre-receive');
      writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do\n if [ "$ref" = refs/heads/production ] && [ -n "$(git rev-list --merges "$old..$new")" ]; then exit 1; fi\ndone\n');
      chmodSync(hook, 0o755);
      const output = join(dir, 'github-env');
      const env = { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', MAIN_SHA: main, GITHUB_ENV: output };
      execFileSync('bash', [script], { cwd: work, env, stdio: 'pipe' });
      git('fetch', 'origin');
      expect(git('rev-parse', 'origin/production^{tree}')).toBe(git('rev-parse', 'origin/main^{tree}'));
      expect(git('rev-list', '--merges', `${base}..origin/production`)).toBe('');
      expect(git('rev-parse', 'origin/production^')).toBe(base);
      expect(readFileSync(output, 'utf8')).toContain(`DEPLOY_SHA=${main}`);
      const production = git('rev-parse', 'origin/production');
      // Retrying the same source does not create another production commit.
      execFileSync('bash', [script], { cwd: work, env, stdio: 'pipe' });
      expect(git('ls-remote', 'origin', 'refs/heads/production').split(/\s/)[0]).toBe(production);
      expect(() => execFileSync('bash', [script], { cwd: work, env: { ...env, MAIN_SHA: base }, stdio: 'pipe' })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
