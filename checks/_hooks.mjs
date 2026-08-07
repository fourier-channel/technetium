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
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx']

// Vite injects `import.meta.env` at build time; Node has no such thing, so any
// source module that reads it throws on import. `import.meta` cannot be
// patched from outside a module, so the source is rewritten as it loads to
// read a global instead. Values come from checks that need them; the default
// is an empty object, which is what a module reading an optional VITE_* var
// expects to fall back from.
globalThis.__TC_ENV__ ??= { DEV: false, PROD: true, MODE: 'test' }

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

  load(url, context, nextLoad) {
    if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
      const path = fileURLToPath(url)
      const source = readFileSync(path, 'utf8')
      if (source.includes('import.meta.env')) {
        return {
          format: 'module-typescript',
          shortCircuit: true,
          source: source.replaceAll('import.meta.env', 'globalThis.__TC_ENV__'),
        }
      }
    }
    return nextLoad(url, context)
  },
})
