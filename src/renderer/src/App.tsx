import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FileTree from './components/FileTree'
import ProjectPanel, { type PanelEntry } from './components/ProjectPanel'
import QuickSearch from './components/QuickSearch'
import Sidebar from './components/Sidebar'
import TaskBar from './components/TaskBar'
import TaskEditor from './components/TaskEditor'
import TerminalView from './components/TerminalView'
import type { AppInfo } from '../../shared/api'
import type {
  Folder,
  ProjectInfo,
  Selection,
  Task,
  TaskStep,
  Workspace
} from '../../shared/types'

interface Tab {
  id: string
  folderId: string
  folderName: string
  cwd: string
  title: string
  command?: string
  /** Conjunto que la lanzó, para poder detenerlas todas juntas. */
  taskId?: string
  /** Se incrementa al reiniciar: fuerza el remonte de la terminal. */
  generation: number
  sessionId: string | null
  exitCode: number | null
}

const EMPTY_WORKSPACE: Workspace = { projects: [], folders: [], tasks: [] }

let tabCounter = 0
const nextTabId = (): string => `tab_${(tabCounter += 1)}`
const scopeKey = (selection: Selection | null): string =>
  selection ? `${selection.type}:${selection.id}` : ''

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [infos, setInfos] = useState<Record<string, ProjectInfo>>({})
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set())
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabByScope, setActiveTabByScope] = useState<Record<string, string>>({})
  // El panel de scripts es una ayuda puntual: arranca cerrado para no comerse
  // el alto de la terminal. El explorador, en cambio, es el mapa del proyecto.
  const [panelOpen, setPanelOpen] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [searchFocus, setSearchFocus] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** `undefined` = editor cerrado; `null` = creando uno nuevo. */
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined)
  const dragDepth = useRef(0)

  const activeProject =
    selection?.type === 'project'
      ? (workspace.projects.find((p) => p.id === selection.id) ?? null)
      : null
  const activeFolder =
    selection?.type === 'folder'
      ? (workspace.folders.find((f) => f.id === selection.id) ?? null)
      : null

  /** Carpetas alcanzadas por la selección actual. */
  const scopeFolders = useMemo<Folder[]>(() => {
    if (activeProject) return workspace.folders.filter((f) => f.projectId === activeProject.id)
    return activeFolder ? [activeFolder] : []
  }, [activeProject, activeFolder, workspace.folders])

  const key = scopeKey(selection)
  const scopeFolderIds = useMemo(() => new Set(scopeFolders.map((f) => f.id)), [scopeFolders])
  const visibleTabs = useMemo(
    () => tabs.filter((t) => scopeFolderIds.has(t.folderId)),
    [tabs, scopeFolderIds]
  )
  // Si la pestaña recordada ya no existe (se cerró, o cambió el proyecto),
  // caemos a la última visible en vez de dejar el área en blanco.
  const activeTab =
    visibleTabs.find((t) => t.id === activeTabByScope[key]) ??
    visibleTabs[visibleTabs.length - 1] ??
    null
  const activeTabId = activeTab?.id

  const runningByFolder = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tab of tabs) {
      if (tab.exitCode === null) counts[tab.folderId] = (counts[tab.folderId] ?? 0) + 1
    }
    return counts
  }, [tabs])

  const runningByTask = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tab of tabs) {
      if (tab.taskId && tab.exitCode === null) {
        counts[tab.taskId] = (counts[tab.taskId] ?? 0) + 1
      }
    }
    return counts
  }, [tabs])

  /* ---------- carga inicial ---------- */

  const applyWorkspace = useCallback((next: Workspace) => {
    setWorkspace(next)
    setSelection((current) => {
      if (current?.type === 'project' && next.projects.some((p) => p.id === current.id)) return current
      if (current?.type === 'folder' && next.folders.some((f) => f.id === current.id)) return current
      if (next.projects.length > 0) return { type: 'project', id: next.projects[0].id }
      if (next.folders.length > 0) return { type: 'folder', id: next.folders[0].id }
      return null
    })
  }, [])

  useEffect(() => {
    window.api.getInfo().then((value) => {
      setInfo(value)
      if (value.platform === 'darwin') {
        // Espacio para los botones de la ventana en la barra integrada.
        document.documentElement.style.setProperty('--titlebar-pad', '34px')
        document.documentElement.style.setProperty('--titlebar-pad-main', '30px')
      }
    })
    window.api.workspace.get().then(applyWorkspace)
  }, [applyWorkspace])

  /* ---------- inspección de las carpetas en foco ---------- */

  const inspectFolders = useCallback((list: Folder[]) => {
    for (const folder of list) {
      window.api.project.inspect(folder.path).then((result) => {
        setInfos((prev) => ({ ...prev, [folder.id]: result }))
        setMissingIds((prev) => {
          const next = new Set(prev)
          if (result.exists) next.delete(folder.id)
          else next.add(folder.id)
          return next
        })
      })
    }
  }, [])

  const scopeSignature = scopeFolders.map((f) => f.id).join(',')
  useEffect(() => {
    inspectFolders(scopeFolders)
    // scopeSignature evita re-inspeccionar en cada render por identidad del array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeSignature, inspectFolders])

  useEffect(() => {
    // La rama de git o los scripts pueden cambiar fuera de la app.
    const onFocus = (): void => inspectFolders(scopeFolders)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [scopeFolders, inspectFolders])

  /* ---------- workspace ---------- */

  const addFolder = useCallback(
    async (projectId: string | null = null) => {
      const before = new Set(workspace.folders.map((f) => f.id))
      const next = await window.api.workspace.pickFolders(projectId)
      applyWorkspace(next)
      const added = next.folders.find((f) => !before.has(f.id))
      if (added && !projectId) setSelection({ type: 'folder', id: added.id })
      if (projectId) setSelection({ type: 'project', id: projectId })
    },
    [workspace.folders, applyWorkspace]
  )

  const removeFolder = useCallback(
    async (id: string) => {
      // Las terminales de esa carpeta se desmontan y matan su sesión.
      setTabs((prev) => prev.filter((t) => t.folderId !== id))
      applyWorkspace(await window.api.workspace.removeFolder(id))
    },
    [applyWorkspace]
  )

  const removeProject = useCallback(
    async (id: string) => {
      applyWorkspace(await window.api.workspace.removeProject(id))
    },
    [applyWorkspace]
  )

  const createProject = useCallback(
    async (name: string) => {
      const next = await window.api.workspace.createProject(name)
      applyWorkspace(next)
      const created = next.projects[next.projects.length - 1]
      if (created) setSelection({ type: 'project', id: created.id })
    },
    [applyWorkspace]
  )

  /* ---------- pestañas ---------- */

  const makeTab = useCallback(
    (folder: Folder, command?: string, title?: string, cwd?: string): Tab => ({
      id: nextTabId(),
      folderId: folder.id,
      folderName: folder.name,
      // El explorador puede pedir una terminal parada en una subcarpeta.
      cwd: cwd ?? folder.path,
      title: title ?? (info?.platform === 'win32' ? 'powershell' : 'shell'),
      command,
      generation: 0,
      sessionId: null,
      exitCode: null
    }),
    [info]
  )

  /** Agrega pestañas y deja activa la primera de la tanda. */
  const pushTabs = useCallback(
    (created: Tab[]): void => {
      if (created.length === 0) return
      setTabs((prev) => [...prev, ...created])
      setActiveTabByScope((prev) => ({ ...prev, [scopeKey(selection)]: created[0].id }))
    },
    [selection]
  )

  const openTab = useCallback(
    (folder: Folder, command?: string, title?: string, cwd?: string): void => {
      pushTabs([makeTab(folder, command, title, cwd)])
    },
    [makeTab, pushTabs]
  )

  const openAllTerminals = useCallback(() => {
    pushTabs(scopeFolders.map((folder) => makeTab(folder)))
  }, [scopeFolders, makeTab, pushTabs])

  /** Lanza todos los comandos del conjunto, cada uno en su carpeta. */
  const runTask = useCallback(
    (task: Task) => {
      const created = task.steps.flatMap((step) => {
        const folder = workspace.folders.find((f) => f.id === step.folderId)
        if (!folder) return []
        return [{ ...makeTab(folder, step.command, step.label ?? step.command), taskId: task.id }]
      })
      pushTabs(created)
    },
    [workspace.folders, makeTab, pushTabs]
  )

  /**
   * Frena las terminales vivas de un conjunto. Las pestañas quedan abiertas con
   * su salida: desde el pie de la terminal se reinician o se cierran.
   */
  const stopTask = useCallback(
    (taskId: string) => {
      for (const tab of tabs) {
        if (tab.taskId === taskId && tab.sessionId) window.api.session.kill(tab.sessionId)
      }
    },
    [tabs]
  )

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId))
    // El scope que apuntaba a esta pestaña resuelve solo su reemplazo en render.
    setActiveTabByScope((current) => {
      const updated: Record<string, string> = {}
      for (const [scope, id] of Object.entries(current)) {
        if (id !== tabId) updated[scope] = id
      }
      return updated
    })
  }, [])

  const restartTab = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, generation: t.generation + 1, exitCode: null, sessionId: null } : t
      )
    )
  }, [])

  const handleSession = useCallback((tabId: string, sessionId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, sessionId } : t)))
  }, [])

  const handleExit = useCallback((tabId: string, exitCode: number) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, exitCode, sessionId: null } : t)))
  }, [])

  /* ---------- menú y drag & drop ---------- */

  useEffect(() => {
    return window.api.onMenuAction((action) => {
      if (action === 'add-folder') void addFolder(activeProject?.id ?? null)
      else if (action === 'new-project') void createProject('Proyecto')
      else if (action === 'new-terminal' && scopeFolders[0]) openTab(scopeFolders[0])
      else if (action === 'open-all-terminals') openAllTerminals()
      else if (action === 'close-tab' && activeTabId) closeTab(activeTabId)
      else if (action === 'toggle-panel') setPanelOpen((v) => !v)
      else if (action === 'toggle-explorer') setExplorerOpen((v) => !v)
      else if (action === 'quick-search') setQuickOpen(scopeFolders.length > 0)
      else if (action === 'focus-search') {
        setExplorerOpen(true)
        setSearchFocus((n) => n + 1)
      }
    })
  }, [
    addFolder,
    createProject,
    openTab,
    openAllTerminals,
    closeTab,
    activeProject,
    scopeFolders,
    activeTabId
  ])

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer.files)
      if (files.length === 0) return
      const paths = window.api.pathsFromDrop(files)
      if (paths.length === 0) return
      applyWorkspace(await window.api.workspace.addPaths(paths, activeProject?.id ?? null))
    },
    [applyWorkspace, activeProject]
  )

  /* ---------- render ---------- */

  const revealLabel =
    info?.platform === 'darwin' ? 'Finder' : info?.platform === 'win32' ? 'Explorador' : 'archivos'

  const panelEntries: PanelEntry[] = scopeFolders.map((folder) => ({
    folder,
    info: infos[folder.id] ?? null
  }))

  const headerTitle = activeProject?.name ?? activeFolder?.name ?? ''
  const folderInfo = activeFolder ? infos[activeFolder.id] : null
  const projectTasks = activeProject
    ? workspace.tasks.filter((t) => t.projectId === activeProject.id)
    : []

  const saveTask = (name: string, steps: TaskStep[]): void => {
    if (!activeProject) return
    const request =
      editingTask == null
        ? window.api.workspace.createTask(activeProject.id, name, steps)
        : window.api.workspace.updateTask(editingTask.id, name, steps)
    void request.then(applyWorkspace)
    setEditingTask(undefined)
  }

  return (
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <Sidebar
        workspace={workspace}
        selection={selection}
        runningByFolder={runningByFolder}
        missingIds={missingIds}
        ptyWarning={info && !info.pty.available ? info.pty.error : null}
        onSelect={setSelection}
        onAddFolder={() => void addFolder(null)}
        onCreateProject={(name) => void createProject(name)}
        onRenameProject={(id, name) =>
          void window.api.workspace.renameProject(id, name).then(applyWorkspace)
        }
        onRemoveFolder={(id) => void removeFolder(id)}
        onRemoveProject={(id) => void removeProject(id)}
        onAssignFolder={(folderId, projectId) =>
          void window.api.workspace.assignFolder(folderId, projectId).then(applyWorkspace)
        }
        onToggleCollapse={(id, collapsed) =>
          void window.api.workspace.setProjectCollapsed(id, collapsed).then(applyWorkspace)
        }
        onAddToProject={(projectId) => void addFolder(projectId)}
      />

      <main className="main">
        {selection ? (
          <>
            <header className="main-head">
              <div className="title-block">
                <h1>
                  {activeProject && <span className="title-kind">proyecto</span>}
                  {headerTitle}
                </h1>
                <div className="title-meta">
                  {activeProject ? (
                    <span>
                      {scopeFolders.length}{' '}
                      {scopeFolders.length === 1 ? 'carpeta' : 'carpetas'}
                    </span>
                  ) : (
                    <>
                      {folderInfo && !folderInfo.exists && (
                        <span style={{ color: 'var(--danger)' }}>carpeta no encontrada</span>
                      )}
                      {folderInfo?.branch && (
                        <span className="chip-branch">⎇ {folderInfo.branch}</span>
                      )}
                      {folderInfo?.packageManager && <span>{folderInfo.packageManager}</span>}
                      <span>{activeFolder?.path}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="head-actions">
                <button
                  className={`btn ghost sm${explorerOpen ? ' on' : ''}`}
                  title="Explorador de archivos (⌘E)"
                  onClick={() => setExplorerOpen((v) => !v)}
                >
                  Archivos
                </button>
                <button className="btn ghost sm" onClick={() => setPanelOpen((v) => !v)}>
                  {panelOpen ? 'Ocultar scripts' : 'Ver scripts'}
                </button>
                {activeProject ? (
                  <>
                    <button className="btn ghost sm" onClick={() => void addFolder(activeProject.id)}>
                      + Carpeta
                    </button>
                    <button
                      className="btn sm"
                      onClick={openAllTerminals}
                      disabled={scopeFolders.length === 0}
                      title="Abre una terminal en cada carpeta del proyecto"
                    >
                      Terminal en todas ({scopeFolders.length})
                    </button>
                  </>
                ) : (
                  activeFolder && (
                    <>
                      <button
                        className="btn ghost sm"
                        onClick={() => void window.api.reveal(activeFolder.path)}
                      >
                        Abrir en {revealLabel}
                      </button>
                      <button className="btn sm" onClick={() => openTab(activeFolder)}>
                        Nueva terminal
                      </button>
                    </>
                  )
                )}
              </div>
            </header>

            {activeProject && scopeFolders.length > 0 && (
              <TaskBar
                tasks={projectTasks}
                folders={scopeFolders}
                runningByTask={runningByTask}
                onRun={runTask}
                onStop={stopTask}
                onEdit={(task) => setEditingTask(task)}
                onRemove={(taskId) =>
                  void window.api.workspace.removeTask(taskId).then(applyWorkspace)
                }
                onCreate={() => setEditingTask(null)}
              />
            )}

            {panelOpen && scopeFolders.length > 0 && (
              <ProjectPanel
                entries={panelEntries}
                showFolderNames={activeProject !== null}
                onRun={(folder, command, title, cwd) => openTab(folder, command, title, cwd)}
                onOpenTerminal={(folder) => openTab(folder)}
              />
            )}

            <div className="main-body">
              {explorerOpen && scopeFolders.length > 0 && (
                <FileTree
                  folders={scopeFolders}
                  focusToken={searchFocus}
                  onOpenTerminal={(folder, cwd, title) => openTab(folder, undefined, title, cwd)}
                />
              )}

              <div className="term-column">
                <div className="tabs">
                  {visibleTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={`tab${tab.id === activeTabId ? ' active' : ''}${
                        tab.exitCode !== null ? ' exited' : ''
                      }`}
                      role="button"
                      tabIndex={0}
                      title={`${tab.folderName} · ${tab.command ?? tab.title}`}
                      onClick={() => setActiveTabByScope((prev) => ({ ...prev, [key]: tab.id }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter')
                          setActiveTabByScope((prev) => ({ ...prev, [key]: tab.id }))
                      }}
                    >
                      <span className="tab-dot" />
                      {activeProject && <span className="tab-scope">{tab.folderName}</span>}
                      <span className="tab-title">{tab.title}</span>
                      <button
                        className="tab-close"
                        title="Cerrar pestaña"
                        onClick={(event) => {
                          event.stopPropagation()
                          closeTab(tab.id)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {scopeFolders.length > 0 && (
                    <button
                      className="tab-add"
                      title="Nueva terminal"
                      onClick={() => openTab(scopeFolders[0])}
                    >
                      +
                    </button>
                  )}
                </div>

                <div className="term-area">
                  {tabs.map((tab) => (
                    <TerminalView
                      key={`${tab.id}:${tab.generation}`}
                      tabId={tab.id}
                      cwd={tab.cwd}
                      command={tab.command}
                      active={tab.id === activeTabId}
                      onSession={handleSession}
                      onExit={handleExit}
                    />
                  ))}

                  {visibleTabs.length === 0 && (
                    <div className="empty">
                      <div className="empty-inner">
                        <div className="empty-icon">▸</div>
                        <h2>Sin terminales abiertas</h2>
                        {scopeFolders.length === 0 ? (
                          <p>
                            Este proyecto todavía no tiene carpetas. Agregá una con <b>+ Carpeta</b>{' '}
                            o arrastrá una carpeta del sidebar hasta el proyecto.
                          </p>
                        ) : (
                          <>
                            <p>
                              Abrí una shell en <b>{headerTitle}</b>, buscá un archivo en el
                              explorador de la izquierda o corré un script desde <b>Ver scripts</b>.
                            </p>
                            <button
                              className="btn primary"
                              onClick={() =>
                                activeProject ? openAllTerminals() : openTab(scopeFolders[0])
                              }
                            >
                              {activeProject
                                ? `Abrir terminal en las ${scopeFolders.length} carpetas`
                                : 'Abrir terminal'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab && activeTab.exitCode !== null && (
                    <div className="term-exit">
                      <span>
                        El proceso terminó con código{' '}
                        <span className="code">{activeTab.exitCode}</span>
                      </span>
                      <button className="btn sm" onClick={() => restartTab(activeTab.id)}>
                        Reiniciar
                      </button>
                      <button className="btn ghost sm" onClick={() => closeTab(activeTab.id)}>
                        Cerrar pestaña
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="empty-inner">
              <div className="empty-icon">📁</div>
              <h2>Agregá tu primera carpeta</h2>
              <p>
                Elegí las carpetas de tus proyectos y desde acá vas a poder recorrer sus archivos,
                buscar por nombre o por contenido, abrir una terminal en cada una y correr sus
                scripts con un click. Si un proyecto tiene varias carpetas (API, cliente, workers),
                agrupalas en un <b>proyecto</b> y abrí todas sus terminales de una vez.
              </p>
              <div className="empty-actions">
                <button className="btn primary" onClick={() => void addFolder(null)}>
                  Agregar carpeta
                </button>
                <button className="btn" onClick={() => void createProject('Mi proyecto')}>
                  Crear proyecto
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {quickOpen && scopeFolders.length > 0 && (
        <QuickSearch folders={scopeFolders} onClose={() => setQuickOpen(false)} />
      )}

      {editingTask !== undefined && activeProject && (
        <TaskEditor
          task={editingTask}
          folders={scopeFolders}
          infos={infos}
          onCancel={() => setEditingTask(undefined)}
          onSave={saveTask}
        />
      )}
    </div>
  )
}
