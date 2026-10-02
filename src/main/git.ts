import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const GIT_ENTRY = '.git'
const GITDIR_POINTER = /^gitdir:\s*(.+)$/m
const BRANCH_REF = /^ref:\s*refs\/heads\/(.+)$/
const ABBREVIATED_HASH_LENGTH = 7

export interface GitMetadata {
  branch: string | null
  /** Ruta del repo principal si la carpeta es un worktree; `null` si es el repo mismo. */
  mainRepoPath: string | null
}

/** Ruta con symlinks resueltos (en macOS `/tmp` y `/private/tmp` son la misma); si no existe, queda como vino. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function parseBranch(headContent: string): string {
  const head = headContent.trim()
  const match = head.match(BRANCH_REF)
  return match ? match[1] : head.slice(0, ABBREVIATED_HASH_LENGTH)
}

/** En un worktree `.git` es un archivo con la línea `gitdir: <ruta>`. */
function resolveWorktreeGitDir(dir: string, gitFile: string): string | null {
  const pointer = readTextFile(gitFile)?.match(GITDIR_POINTER)
  return pointer ? resolve(dir, pointer[1].trim()) : null
}

function resolveCommonDir(gitDir: string): string {
  const commonDirFile = readTextFile(join(gitDir, 'commondir'))
  return commonDirFile ? resolve(gitDir, commonDirFile.trim()) : gitDir
}

/** `null` si la carpeta no es un repo de git ni un worktree. */
export function readGitMetadata(dir: string): GitMetadata | null {
  const gitEntry = join(dir, GIT_ENTRY)
  let stats
  try {
    stats = statSync(gitEntry)
  } catch {
    return null
  }

  if (stats.isDirectory()) {
    return { branch: readBranchFrom(gitEntry), mainRepoPath: null }
  }

  const gitDir = resolveWorktreeGitDir(dir, gitEntry)
  if (!gitDir) return null
  const commonDir = resolveCommonDir(gitDir)
  return {
    branch: readBranchFrom(gitDir),
    mainRepoPath: basename(commonDir) === GIT_ENTRY ? canonicalPath(dirname(commonDir)) : null
  }
}

function readBranchFrom(gitDir: string): string | null {
  const head = readTextFile(join(gitDir, 'HEAD'))
  return head === null ? null : parseBranch(head)
}
