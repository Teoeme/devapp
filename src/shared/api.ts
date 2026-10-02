import type {
  DirEntry,
  ExternalFolderOpened,
  FileSearchOptions,
  FileSearchResult,
  ProjectInfo,
  SessionCreated,
  SessionOptions,
  TaskStep,
  Workspace
} from './types'

export interface AppInfo {
  platform: NodeJS.Platform
  version: string
  pty: { available: boolean; error: string | null }
}

export type MenuAction =
  | 'add-folder'
  | 'new-project'
  | 'new-terminal'
  | 'open-all-terminals'
  | 'close-tab'
  | 'toggle-panel'
  | 'toggle-explorer'
  | 'quick-search'
  | 'focus-search'

/** Contrato del bridge expuesto por el preload en `window.api`. */
export interface DevAppApi {
  getInfo(): Promise<AppInfo>

  workspace: {
    get(): Promise<Workspace>
    /** Abre el diálogo nativo; si se pasa `projectId`, las agrega a ese proyecto. */
    pickFolders(projectId?: string | null): Promise<Workspace>
    addPaths(paths: string[], projectId?: string | null): Promise<Workspace>
    removeFolder(folderId: string): Promise<Workspace>
    renameFolder(folderId: string, name: string): Promise<Workspace>
    assignFolder(folderId: string, projectId: string | null): Promise<Workspace>
    createProject(name: string, folderIds?: string[]): Promise<Workspace>
    renameProject(projectId: string, name: string): Promise<Workspace>
    removeProject(projectId: string): Promise<Workspace>
    setProjectCollapsed(projectId: string, collapsed: boolean): Promise<Workspace>
    createTask(projectId: string, name: string, steps: TaskStep[]): Promise<Workspace>
    updateTask(taskId: string, name: string, steps: TaskStep[]): Promise<Workspace>
    removeTask(taskId: string): Promise<Workspace>
  }

  project: {
    inspect(path: string): Promise<ProjectInfo>
    /** Cuáles de estas rutas ya no existen como carpeta (solo `stat`, sin inspeccionar). */
    findMissing(paths: string[]): Promise<string[]>
  }

  files: {
    /** Contenido de una carpeta: el árbol se carga por nivel, no de una. */
    read(path: string): Promise<DirEntry[]>
    search(options: FileSearchOptions): Promise<FileSearchResult>
  }

  reveal(path: string): Promise<void>

  /** Muestra un archivo dentro de su carpeta en Finder/Explorador. */
  revealItem(path: string): Promise<void>

  /** Abre el archivo con la app asociada del sistema. Devuelve el error si falla. */
  openPath(path: string): Promise<string>

  /** Resuelve rutas reales de archivos soltados sobre la ventana (drag & drop). */
  pathsFromDrop(files: File[]): string[]

  onMenuAction(listener: (action: MenuAction) => void): () => void

  /** Carpeta abierta desde afuera (`open -a Selene <ruta>`); ya está agregada al workspace. */
  onExternalFolderOpened(listener: (event: ExternalFolderOpened) => void): () => void

  /** Avisa al main que el renderer ya escucha: recién ahí se le entregan las carpetas pendientes. */
  notifyExternalReady(): void

  session: {
    create(options: SessionOptions): Promise<SessionCreated>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(listener: (id: string, data: string) => void): () => void
    onExit(listener: (id: string, exitCode: number) => void): () => void
  }
}
