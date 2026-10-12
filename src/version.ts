/**
 * This package's installed version.
 *
 * Kept apart from anything release-related on purpose: this plugin is a fork
 * that has been heavily refactored, so tracking the upstream project's releases
 * would be misleading. All that remains is the local version the panel shows
 * beside its title.
 *
 * @module dsh-skill-mgr/version
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Installed plugin version, read from this package's manifest.
 *
 * The lookup walks up from this module instead of assuming a depth: the host
 * half compiles to `lib/types/*.js`, so a literal `../package.json` would name
 * `lib/package.json` and throw at load time. Walking up also keeps the read
 * correct if the output layout ever changes again.
 */
export const CURRENT_VERSION = readPackageVersion()

/** Walk up to the nearest manifest that names this package. */
function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 5; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
      if (manifest.name === 'dsh-skill-mgr' && typeof manifest.version === 'string') return manifest.version
    } catch {
      /* not a manifest, or unreadable: keep walking */
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return '0.0.0'
}
