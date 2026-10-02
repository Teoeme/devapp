import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDirectory, searchFiles } from './files'
import { buildMenu } from './menu'
import { isDirectory, isDirectoryAsync, normalizeFolderPath } from './paths'
import { inspectProject } from './projects'
import {
  addExternalFolder,
  addFolders,
  assignFolder,
  createProject,
  createTask,
  getWorkspace,
  pruneVanishedExternalFolders,
  removeFolder,
  removeProject,
  removeTask,
  renameFolder,
  renameProject,
  setProjectCollapsed,
  updateTask
} from './store'
import {
  createSession,
  killAllSessions,
  killSession,
  ptyStatus,
  resizeSession,
  writeSession
} from './terminals'
import type {
  ExternalFolderOpened,
  FileSearchOptions,
  SessionOptions,
  TaskStep
} from '../shared/types'

/** Carpeta de datos del modo desarrollo: no debe compartir datos ni candado con la app instalada. */
const DEVELOPMENT_USER_DATA_DIR = 'selene-dev'
/** `argv` empaquetado: [ejecutable, ...args]; en desarrollo: [electron, script, ...args]. */
const PACKAGED_ARGV_OFFSET = 1
const DEVELOPMENT_ARGV_OFFSET = 2

const __dirname_ = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null

/** Rutas pedidas desde afuera que todavía no se agregaron al workspace (app o renderer sin listo). */
const pendingExternalPaths: string[] = []
let rendererListening = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#0d0f13',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname_, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // Recargar (o el HMR) reinicia el renderer: hasta que vuelva a avisar, se encola.
  mainWindow.webContents.on('did-start-loading', () => {
    rendererListening = false
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererListening = false
    // Cerrar la ventana descarta las pestañas: sus procesos no deben sobrevivir.
    killAllSessions()
  })

  // Nada de navegar fuera de la app; los links externos van al navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    // La app se sirve desde file:// (o desde el dev server): esas navegaciones
    // son internas — incluye un location.reload(). Todo lo demás sale afuera.
    if (url.startsWith('file://') || (devUrl && url.startsWith(devUrl))) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname_, '../renderer/index.html'))
  }
}

/** Argumentos de línea de comandos que son carpetas; los relativos se resuelven contra `baseDir`. */
function folderPathsFromArgv(argv: string[], baseDir: string): string[] {
  const offset = app.isPackaged ? PACKAGED_ARGV_OFFSET : DEVELOPMENT_ARGV_OFFSET
  return argv
    .slice(offset)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => normalizeFolderPath(arg, baseDir))
}

/** Lo que una segunda instancia le pasa a la principal antes de cerrarse. */
interface SecondInstanceData {
  folderPaths: string[]
}

function folderPathsFromInstanceData(data: unknown): string[] {
  const folderPaths = (data as Partial<SecondInstanceData> | null)?.folderPaths
  return Array.isArray(folderPaths) ? folderPaths.filter((path) => typeof path === 'string') : []
}

function liveMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Trae la ventana al frente; si no hay (macOS la deja cerrar), la crea. */
function showMainWindow(): void {
  if (!app.isReady()) return
  if (!liveMainWindow()) createWindow()
  const window = liveMainWindow()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** Agrega al workspace las carpetas pendientes y avisa al renderer; espera a que este escuche. */
function addPendingFoldersAndNotify(): void {
  if (!rendererListening) return
  for (const path of pendingExternalPaths.splice(0)) {
    try {
      if (!isDirectory(path)) continue
      const opened: ExternalFolderOpened = addExternalFolder(path)
      liveMainWindow()?.webContents.send('external:folder-opened', opened)
    } catch (error) {
      console.error(`No se pudo abrir la carpeta externa ${path}`, error)
    }
  }
}

/** Único punto de entrada de carpetas abiertas desde afuera (open-file, argv, segunda instancia). */
function openExternalFolder(path: string): void {
  pendingExternalPaths.push(normalizeFolderPath(path))
  // `open-file` puede llegar antes de `ready`: la ventana se crea al arrancar.
  showMainWindow()
  addPendingFoldersAndNotify()
}

function registerIpc(): void {
  ipcMain.on('external:ready', () => {
    rendererListening = true
    addPendingFoldersAndNotify()
  })

  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    pty: ptyStatus()
  }))

  ipcMain.handle('workspace:get', () => getWorkspace())

  ipcMain.handle('workspace:pickFolders', async (_event, projectId: string | null) => {
    const options = {
      title: projectId ? 'Agregar carpetas al proyecto' : 'Agregar carpetas',
      properties: ['openDirectory', 'multiSelections', 'createDirectory'] as const
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { ...options, properties: [...options.properties] })
      : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
    if (result.canceled || result.filePaths.length === 0) return getWorkspace()
    return addFolders(result.filePaths, projectId ?? null)
  })

  ipcMain.handle('workspace:addPaths', (_event, paths: string[], projectId: string | null) => {
    const dirs = (Array.isArray(paths) ? paths : []).filter(isDirectory)
    return dirs.length > 0 ? addFolders(dirs, projectId ?? null) : getWorkspace()
  })

  ipcMain.handle('workspace:removeFolder', (_event, id: string) => removeFolder(id))
  ipcMain.handle('workspace:renameFolder', (_event, id: string, name: string) =>
    renameFolder(id, name)
  )
  ipcMain.handle('workspace:assignFolder', (_event, id: string, projectId: string | null) =>
    assignFolder(id, projectId)
  )
  ipcMain.handle('workspace:createProject', (_event, name: string, folderIds: string[]) =>
    createProject(name, Array.isArray(folderIds) ? folderIds : [])
  )
  ipcMain.handle('workspace:renameProject', (_event, id: string, name: string) =>
    renameProject(id, name)
  )
  ipcMain.handle('workspace:removeProject', (_event, id: string) => removeProject(id))
  ipcMain.handle('workspace:setProjectCollapsed', (_event, id: string, collapsed: boolean) =>
    setProjectCollapsed(id, collapsed)
  )
  ipcMain.handle(
    'workspace:createTask',
    (_event, projectId: string, name: string, steps: TaskStep[]) =>
      createTask(projectId, name, steps)
  )
  ipcMain.handle('workspace:updateTask', (_event, id: string, name: string, steps: TaskStep[]) =>
    updateTask(id, name, steps)
  )
  ipcMain.handle('workspace:removeTask', (_event, id: string) => removeTask(id))

  ipcMain.handle('project:inspect', (_event, path: string) => inspectProject(path))
  // Asincrónico: un volumen de red colgado no debe congelar el proceso que bombea las terminales.
  ipcMain.handle('project:findMissing', async (_event, paths: string[]) => {
    const candidates = Array.isArray(paths) ? paths : []
    const present = await Promise.all(candidates.map(isDirectoryAsync))
    return candidates.filter((_path, index) => !present[index])
  })

  ipcMain.handle('files:read', (_event, path: string) => readDirectory(path))
  ipcMain.handle('files:search', (_event, options: FileSearchOptions) => searchFiles(options))

  ipcMain.handle('shell:reveal', (_event, path: string) => {
    if (isDirectory(path)) shell.openPath(path)
  })

  /** Muestra el archivo seleccionado dentro de su carpeta, en el explorador del SO. */
  ipcMain.handle('shell:revealItem', (_event, path: string) => {
    if (existsSync(path)) shell.showItemInFolder(path)
  })

  /** Abre el archivo con la app que tenga asociada el SO (el editor, casi siempre). */
  ipcMain.handle('shell:open', async (_event, path: string) => {
    if (!existsSync(path)) return 'No existe'
    return shell.openPath(path)
  })

  ipcMain.handle('session:create', (event, options: SessionOptions) => {
    if (!isDirectory(options.cwd)) {
      throw new Error(`La carpeta ya no existe: ${options.cwd}`)
    }
    return createSession(event.sender, options)
  })

  ipcMain.on('session:write', (_event, id: string, data: string) => writeSession(id, data))
  ipcMain.on('session:resize', (_event, id: string, cols: number, rows: number) =>
    resizeSession(id, cols, rows)
  )
  ipcMain.on('session:kill', (_event, id: string) => killSession(id))
}

function startApp(): void {
  pendingExternalPaths.push(...instanceData.folderPaths)

  // macOS entrega las carpetas por este evento (no por argv), incluso antes de `ready`.
  app.on('open-file', (event, path) => {
    event.preventDefault()
    openExternalFolder(path)
  })

  // No se usa el `argv` del evento: Chromium le intercala switches propios y
  // las posiciones dejan de valer. Las rutas llegan ya resueltas por la otra instancia.
  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    const folderPaths = folderPathsFromInstanceData(additionalData)
    for (const path of folderPaths) openExternalFolder(path)
    // Sin carpetas, igual traemos la ventana al frente.
    if (folderPaths.length === 0) showMainWindow()
  })

  app.whenReady().then(() => {
    pruneVanishedExternalFolders()
    registerIpc()
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

// El candado de instancia única depende de userData: se separa antes de pedirlo.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), DEVELOPMENT_USER_DATA_DIR))
}

const instanceData: SecondInstanceData = {
  folderPaths: folderPathsFromArgv(process.argv, process.cwd())
}

if (app.requestSingleInstanceLock(instanceData)) {
  startApp()
} else {
  app.quit()
}

// Al salir no alcanza con pedir el kill y cerrar: hay que darle al SIGKILL de
// respaldo el tiempo de llegar, o los procesos hijos quedan huérfanos.
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) return
  shuttingDown = true
  event.preventDefault()
  killAllSessions()
  setTimeout(() => app.exit(0), 300)
})

// Cierres que no pasan por before-quit (Ctrl+C en desarrollo, SIGTERM del SO).
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    killAllSessions()
    setTimeout(() => process.exit(0), 300)
  })
}
