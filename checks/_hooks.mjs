// Lets `npm run check` load the app's source modules unchanged.
//
// The tree uses bundler-style extensionless relative imports ("./eventPreview"),
// which Vite and tsc resolve but bare Node does not. Rather than making source
// files carry .ts extensions purely to satisfy the harness, this registers a
// resolve hook that appends .ts when an extensionless relative specifier has a
// matching file. Node's own resolution is left alone for everything else.
//
// registerHooks is synchronous and in-thread, so a single --import applies it
// before the check module is loaded.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx']

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
    const hasExt = /\.[cm]?[jt]sx?$/.test(specifier)
    if (isRelative && !hasExt && context.parentURL?.startsWith('file:')) {
      const base = dirname(fileURLToPath(context.parentURL))
      for (const ext of EXTENSIONS) {
        const candidate = resolvePath(base, specifier + ext)
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true }
        }
      }
    }
    return nextResolve(specifier, context)
  },
})
