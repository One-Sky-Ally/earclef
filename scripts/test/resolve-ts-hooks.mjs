import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs']
const HAS_EXTENSION = /\.[a-z]+$/i

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  if (relative && !HAS_EXTENSION.test(specifier) && context.parentURL?.startsWith('file:')) {
    const base = new URL(specifier, context.parentURL)
    const path = fileURLToPath(base)
    const extension = EXTENSIONS.find((candidate) => existsSync(path + candidate))
    if (extension) return next(`${base.href}${extension}`, context)
  }
  return next(specifier, context)
}
