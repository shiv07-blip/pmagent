import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

/**
 * npm workspaces run scripts with cwd = package dir, but the shared .env lives
 * at the repo root. Walk up until we find one and load it (dotenv never
 * overrides already-set variables).
 */
export function loadRootEnv(): void {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
