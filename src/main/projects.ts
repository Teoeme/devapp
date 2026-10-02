import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PackageManager, ProjectInfo, Subpackage } from '../shared/types'

const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts']
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage'])
/** Alcanza para `packages/core/docs/manual/pdf` sin recorrer árboles de fuentes enteros. */
const MAX_SUBPACKAGE_DEPTH = 5
/** Tope de carpetas leídas por inspección: se corre cada vez que se abre una carpeta. */
const MAX_SCANNED_DIRS = 2000
const MAX_SUBPACKAGES = 50

function detectLockfileManager(dir: string): PackageManager | null {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
  return null
}

function detectPackageManager(dir: string): PackageManager | null {
  return detectLockfileManager(dir) ?? (existsSync(join(dir, 'package.json')) ? 'npm' : null)
}

function readScripts(dir: string): Record<string, string> {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return {}
    const scripts: Record<string, string> = {}
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (typeof cmd === 'string') scripts[name] = cmd
    }
    return scripts
  } catch {
    return {}
  }
}

function readBranch(dir: string): string | null {
  const headPath = join(dir, '.git', 'HEAD')
  if (!existsSync(headPath)) return null
  try {
    const head = readFileSync(headPath, 'utf8').trim()
    const match = head.match(/^ref:\s*refs\/heads\/(.+)$/)
    return match ? match[1] : head.slice(0, 7)
  } catch {
    return null
  }
}

/** Archivos ejecutables con node en la raíz y en `scripts/`. */
function findNodeFiles(dir: string): string[] {
  const found: string[] = []

  const scan = (base: string, prefix: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(base)
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= 50) return
      if (entry.startsWith('.') || IGNORED_DIRS.has(entry)) continue
      if (!SCRIPT_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue
      if (entry.endsWith('.d.ts')) continue
      found.push(prefix ? `${prefix}/${entry}` : entry)
    }
  }

  scan(dir, '')
  const scriptsDir = join(dir, 'scripts')
  if (existsSync(scriptsDir)) {
    try {
      if (statSync(scriptsDir).isDirectory()) scan(scriptsDir, 'scripts')
    } catch {
      /* sin permisos */
    }
  }

  return found.sort()
}

/**
 * package.json con scripts en subcarpetas. En un workspace el lockfile vive en
 * la raíz, así que sin lockfile propio el paquete usa el gestor de la raíz.
 */
function findSubpackages(root: string, rootManager: PackageManager): Subpackage[] {
  const found: Subpackage[] = []
  let scannedDirs = 0

  const walk = (dir: string, relDir: string, depth: number): void => {
    if (depth > MAX_SUBPACKAGE_DEPTH) return
    let entries: Dirent[]
    try {
      // Ordenadas para que el tope deje afuera siempre los mismos paquetes.
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_SUBPACKAGES || scannedDirs >= MAX_SCANNED_DIRS) return
      if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      scannedDirs++
      const childDir = join(dir, entry.name)
      const childRelDir = relDir ? `${relDir}/${entry.name}` : entry.name
      const scripts = readScripts(childDir)
      if (Object.keys(scripts).length > 0) {
        found.push({
          relDir: childRelDir,
          path: childDir,
          packageManager: detectLockfileManager(childDir) ?? rootManager,
          scripts
        })
      }
      walk(childDir, childRelDir, depth + 1)
    }
  }

  walk(root, '', 1)
  return found.sort((a, b) => a.relDir.localeCompare(b.relDir))
}

export function inspectProject(dir: string): ProjectInfo {
  if (!existsSync(dir)) {
    return {
      exists: false,
      isGitRepo: false,
      branch: null,
      packageManager: null,
      scripts: {},
      subpackages: [],
      nodeFiles: []
    }
  }

  const packageManager = detectPackageManager(dir)
  return {
    exists: true,
    isGitRepo: existsSync(join(dir, '.git')),
    branch: readBranch(dir),
    packageManager,
    scripts: readScripts(dir),
    subpackages: findSubpackages(dir, packageManager ?? 'npm'),
    nodeFiles: findNodeFiles(dir)
  }
}
