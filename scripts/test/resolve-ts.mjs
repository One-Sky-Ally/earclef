/**
 * Test-time module resolution for lib/ TypeScript: the site's modules
 * import each other WITHOUT extensions (Next and the Netlify bundler
 * resolve those), while Node's own runner needs a file. This hook adds
 * the extension when the extensionless file exists — nothing else.
 *
 *   node --import ./scripts/test/resolve-ts.mjs --test lib/**\/*.test.ts
 */
import { register } from 'node:module'

register('./resolve-ts-hooks.mjs', import.meta.url)
