import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { canonicalPath, readGitMetadata } from './git'
import { isDirectory } from './paths'
import type { Folder, Project, Task, TaskStep, Workspace } from '../shared/types'

/** Nombres de userData de antes del rebranding a Selene. */
const LEGACY_APP_DIRS = ['devapp', 'DevApp']

function storePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'workspace.json')
}

/**
 * Al renombrar la app cambia la carpeta de userData: sin esto, quien venía
 * usándola como DevApp abriría Selene con la lista de proyectos vacía.
 */
function legacyStorePath(): string | null {
  const parent = dirname(app.getPath('userData'))
  for (const name of LEGACY_APP_DIRS) {
    const candidate = join(parent, name, 'workspace.json')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function read(): Workspace {
  const own = storePath()
  const file = existsSync(own) ? own : legacyStorePath()
  if (!file) return { projects: [], folders: [], tasks: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Workspace>
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      // `projectId` y `origin` pueden faltar en datos guardados por versiones anteriores.
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.map((f) => ({
            ...f,
            projectId: f.projectId ?? null,
            origin: f.origin ?? 'manual'
          }))
        : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    }
  } catch {
    // Un archivo corrupto no debe impedir arrancar: lo apartamos y empezamos limpio.
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* no-op */
    }
    return { projects: [], folders: [], tasks: [] }
  }
}

/**
 * Descarta pasos que apuntan a carpetas borradas o que ya no pertenecen al
 * proyecto del conjunto, y conjuntos que quedaron sin pasos o sin proyecto.
 */
function pruneTasks(data: Workspace): void {
  const folderById = new Map(data.folders.map((f) => [f.id, f]))
  const projectIds = new Set(data.projects.map((p) => p.id))

  data.tasks = data.tasks
    .filter((task) => projectIds.has(task.projectId))
    .map((task) => ({
      ...task,
      steps: task.steps.filter((step) => {
        const folder = folderById.get(step.folderId)
        return folder !== undefined && folder.projectId === task.projectId
      })
    }))
    .filter((task) => task.steps.length > 0)
}

function write(data: Workspace): Workspace {
  pruneTasks(data)
  writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8')
  return data
}

export function getWorkspace(): Workspace {
  return read()
}

/* ---------- carpetas ---------- */

export function addFolders(paths: string[], projectId: string | null = null): Workspace {
  const data = read()
  const byPath = new Map(data.folders.map((f) => [f.path, f]))

  for (const path of paths) {
    const existing = byPath.get(path)
    if (existing) {
      // Ya estaba: si se está agregando a un proyecto, la movemos ahí.
      if (projectId) existing.projectId = projectId
      // Agregarla a mano es decidir conservarla: deja de ser efímera.
      existing.origin = 'manual'
      continue
    }
    const folder: Folder = {
      id: id('f'),
      path,
      name: basename(path) || path,
      addedAt: Date.now(),
      projectId,
      origin: 'manual'
    }
    data.folders.push(folder)
    byPath.set(path, folder)
  }

  return write(data)
}

/**
 * Descarta las carpetas externas cuya ruta ya no existe (worktrees borrados).
 * Se llama una vez al arrancar: durante la sesión se muestran como eliminadas
 * para no cortar a un agente que todavía esté terminando. Las que usa algún
 * conjunto de scripts se conservan: descartarlas borraría sus pasos en silencio.
 */
export function pruneVanishedExternalFolders(): void {
  const data = read()
  const folderIdsInTasks = new Set(data.tasks.flatMap((t) => t.steps.map((s) => s.folderId)))
  const survivors = data.folders.filter(
    (f) => f.origin === 'manual' || folderIdsInTasks.has(f.id) || isDirectory(f.path)
  )
  if (survivors.length === data.folders.length) return
  data.folders = survivors
  write(data)
}

/** Proyecto de la carpeta que aloja el repo principal de este worktree, si hay uno. */
function findProjectOfMainRepo(data: Workspace, dir: string): string | null {
  const mainRepoPath = readGitMetadata(dir)?.mainRepoPath
  if (!mainRepoPath) return null
  const mainRepoFolder = data.folders.find((f) => canonicalPath(f.path) === mainRepoPath)
  return mainRepoFolder?.projectId ?? null
}

/**
 * Agrega una carpeta abierta desde afuera. Si ya estaba, conserva su origen y
 * su proyecto; si es un worktree de un repo ya agrupado, entra en ese proyecto
 * (también si ya estaba suelta, por si el repo principal se agregó después).
 */
export function addExternalFolder(path: string): { workspace: Workspace; folderId: string } {
  const data = read()
  const known = data.folders.find((f) => f.path === path)
  if (known) {
    const projectId = known.origin === 'external' && !known.projectId
      ? findProjectOfMainRepo(data, path)
      : null
    if (!projectId) return { workspace: data, folderId: known.id }
    known.projectId = projectId
    return { workspace: write(data), folderId: known.id }
  }

  const folder: Folder = {
    id: id('f'),
    path,
    name: basename(path) || path,
    addedAt: Date.now(),
    projectId: findProjectOfMainRepo(data, path),
    origin: 'external'
  }
  data.folders.push(folder)
  return { workspace: write(data), folderId: folder.id }
}

export function removeFolder(folderId: string): Workspace {
  const data = read()
  data.folders = data.folders.filter((f) => f.id !== folderId)
  return write(data)
}

export function renameFolder(folderId: string, name: string): Workspace {
  const data = read()
  const folder = data.folders.find((f) => f.id === folderId)
  if (folder) folder.name = name.trim() || basename(folder.path)
  return write(data)
}

export function assignFolder(folderId: string, projectId: string | null): Workspace {
  const data = read()
  const folder = data.folders.find((f) => f.id === folderId)
  if (!folder) return data
  const target = projectId && data.projects.some((p) => p.id === projectId) ? projectId : null
  folder.projectId = target
  return write(data)
}

/* ---------- proyectos ---------- */

export function createProject(name: string, folderIds: string[] = []): Workspace {
  const data = read()
  const project: Project = {
    id: id('p'),
    name: name.trim() || 'Proyecto',
    createdAt: Date.now()
  }
  data.projects.push(project)
  for (const folder of data.folders) {
    if (folderIds.includes(folder.id)) folder.projectId = project.id
  }
  return write(data)
}

export function renameProject(projectId: string, name: string): Workspace {
  const data = read()
  const project = data.projects.find((p) => p.id === projectId)
  if (project) project.name = name.trim() || project.name
  return write(data)
}

/** Borra el proyecto; sus carpetas quedan sueltas, nunca se pierden. */
export function removeProject(projectId: string): Workspace {
  const data = read()
  data.projects = data.projects.filter((p) => p.id !== projectId)
  for (const folder of data.folders) {
    if (folder.projectId === projectId) folder.projectId = null
  }
  return write(data)
}

export function setProjectCollapsed(projectId: string, collapsed: boolean): Workspace {
  const data = read()
  const project = data.projects.find((p) => p.id === projectId)
  if (project) project.collapsed = collapsed
  return write(data)
}

/* ---------- conjuntos de scripts ---------- */

function sanitizeSteps(steps: TaskStep[]): TaskStep[] {
  return (Array.isArray(steps) ? steps : [])
    .filter((step) => step && typeof step.folderId === 'string' && typeof step.command === 'string')
    .map((step) => ({
      folderId: step.folderId,
      command: step.command.trim(),
      label: step.label?.trim() || undefined
    }))
    .filter((step) => step.command.length > 0)
}

export function createTask(projectId: string, name: string, steps: TaskStep[]): Workspace {
  const data = read()
  if (!data.projects.some((p) => p.id === projectId)) return data
  data.tasks.push({
    id: id('t'),
    projectId,
    name: name.trim() || 'Conjunto',
    steps: sanitizeSteps(steps),
    createdAt: Date.now()
  })
  return write(data)
}

export function updateTask(taskId: string, name: string, steps: TaskStep[]): Workspace {
  const data = read()
  const task = data.tasks.find((t) => t.id === taskId)
  if (!task) return data
  task.name = name.trim() || task.name
  task.steps = sanitizeSteps(steps)
  return write(data)
}

export function removeTask(taskId: string): Workspace {
  const data = read()
  data.tasks = data.tasks.filter((t) => t.id !== taskId)
  return write(data)
}
