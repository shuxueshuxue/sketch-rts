import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, readlinkSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('atomic production installation', () => {
  for (const failStart of [false, true]) {
    it(failStart ? 'restores the previous release if service start fails' : 'installs and can retry without deleting the running release', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rts-install-'));
      const root = join(dir, 'app');
      const previous = join(root, 'releases', 'a'.repeat(40));
      const revision = 'b'.repeat(40);
      const bin = join(dir, 'bin');
      const units = join(dir, 'units');
      const artifact = join(dir, 'release.tar.gz');
      const input = join(dir, 'input');
      try {
        for (const p of [previous, bin, units, join(input, 'dist'), join(input, 'dist-server')]) mkdirSync(p, { recursive: true });
        writeFileSync(join(input, 'dist/index.html'), 'new frontend');
        writeFileSync(join(input, 'dist-server/index.mjs'), 'new server');
        writeFileSync(join(units, 'sketch-rts.service'), 'existing unit');
        symlinkSync(previous, join(root, 'current'));
        writeFileSync(join(root, '.deployed-revision'), 'a'.repeat(40));
        writeFileSync(join(bin, 'systemctl'), `#!/bin/bash\nif [[ "$1" == start && "${failStart}" == true && "$(readlink "$DEPLOY_ROOT/current")" == *${revision} ]]; then exit 1; fi\nexit 0\n`);
        writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 0\n');
        chmodSync(join(bin, 'systemctl'), 0o755); chmodSync(join(bin, 'curl'), 0o755);
        execFileSync('tar', ['-czf', artifact, '-C', input, 'dist', 'dist-server']);
        const run = () => execFileSync('bash', ['-c', 'umask 077; exec bash "$@"', 'deploy', resolve('scripts/deploy-production.sh'), artifact, revision], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_ROOT: root, SYSTEMD_UNIT_DIR: units, DEPLOY_LOCK_PATH: join(dir, 'lock') }, stdio: 'pipe' });
        if (failStart) {
          expect(run).toThrow();
          expect(readlinkSync(join(root, 'current'))).toBe(previous);
          expect(readFileSync(join(root, '.deployed-revision'), 'utf8')).toBe('a'.repeat(40));
        } else {
          run(); run();
          expect(readlinkSync(join(root, 'current'))).toBe(join(root, 'releases', revision));
          expect(readFileSync(join(root, '.deployed-revision'), 'utf8').trim()).toBe(revision);
          expect(existsSync(previous)).toBe(true);
          expect(statSync(join(root, 'current')).mode & 0o777).toBe(0o755);
          expect(statSync(join(root, 'current/dist/index.html')).mode & 0o777).toBe(0o644);
          expect(readFileSync(join(units, 'sketch-rts.service'), 'utf8')).toBe('existing unit');
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
