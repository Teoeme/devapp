export interface Folder {
  id: string
  path: string
  name: string
  addedAt: number
  /** Proyecto al que pertenece; `null` si es una carpeta suelta. */
  projectId: string | null
}

export interface Project {
  id: string
  name: string
  createdAt: number
  collapsed?: boolean
}

/** Un comando concreto a correr en una carpeta puntual. */
export interface TaskStep {
  folderId: string
  command: string
  /** Nombre corto para la pestaña; por defecto, el comando. */
  label?: string
}

/**
 * Conjunto de comandos de un proyecto que se lanzan juntos, cada uno en su
 * carpeta y en su propia terminal. Ej: `npm run dev` en la API + en el cliente.
 */
export interface Task {
  id: string
  projectId: string
  name: string
  steps: TaskStep[]
  createdAt: number
}

export interface Workspace {
  projects: Project[]
  folders: Folder[]
  tasks: Task[]
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

/** Un package.json con scripts dentro de una subcarpeta (monorepos). */
export interface Subpackage {
  /** Ruta relativa a la carpeta abierta, con `/`. Ej: `packages/core`. */
  relDir: string
  /** Ruta absoluta de la carpeta del package.json. */
  path: string
  packageManager: PackageManager
  scripts: Record<string, string>
  nodeFiles: string[]
}

export interface ProjectInfo {
  exists: boolean
  isGitRepo: boolean
  branch: string | null
  packageManager: PackageManager | null
  scripts: Record<string, string>
  subpackages: Subpackage[]
  nodeFiles: string[]
}

/** Una entrada del explorador de archivos. */
export interface DirEntry {
  name: string
  /** Ruta absoluta. */
  path: string
  isDirectory: boolean
  /** Carpeta pesada (node_modules, .git, dist…): el buscador no entra ahí. */
  skipped: boolean
}

export type SearchMode = 'name' | 'content'

export interface SearchRoot {
  id: string
  name: string
  path: string
}

export interface FileSearchOptions {
  roots: SearchRoot[]
  query: string
  mode: SearchMode
  caseSensitive?: boolean
}

export interface FileSearchHit {
  rootId: string
  rootName: string
  /** Ruta absoluta del archivo. */
  path: string
  /** Ruta relativa a la carpeta raíz; es lo que se muestra. */
  relPath: string
  /** Solo en búsqueda por contenido: línea (1-based) y su recorte. */
  line?: number
  preview?: string
  matchStart?: number
  matchLength?: number
}

export interface FileSearchResult {
  hits: FileSearchHit[]
  /** Se cortó por límite de resultados, de archivos o de tiempo. */
  truncated: boolean
  scanned: number
}

export interface SessionOptions {
  cwd: string
  /** Comando a ejecutar en vez de abrir una shell interactiva. */
  command?: string
  cols?: number
  rows?: number
}

export interface SessionCreated {
  id: string
  /** `false` cuando node-pty no está disponible y se usó el fallback por pipes. */
  pty: boolean
}

export interface SessionExit {
  id: string
  exitCode: number
  signal?: number
}

/** Qué está seleccionado en el sidebar. */
export type Selection = { type: 'project'; id: string } | { type: 'folder'; id: string }
