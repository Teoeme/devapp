import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppInfo, DevAppApi, MenuAction } from '../shared/api'
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
} from '../shared/types'

const api: DevAppApi = {
  getInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  workspace: {
    get: (): Promise<Workspace> => ipcRenderer.invoke('workspace:get'),
    pickFolders: (projectId = null): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:pickFolders', projectId),
    addPaths: (paths: string[], projectId = null): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:addPaths', paths, projectId),
    removeFolder: (folderId: string): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:removeFolder', folderId),
    renameFolder: (folderId: string, name: string): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:renameFolder', folderId, name),
    assignFolder: (folderId: string, projectId: string | null): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:assignFolder', folderId, projectId),
    createProject: (name: string, folderIds: string[] = []): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:createProject', name, folderIds),
    renameProject: (projectId: string, name: string): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:renameProject', projectId, name),
    removeProject: (projectId: string): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:removeProject', projectId),
    setProjectCollapsed: (projectId: string, collapsed: boolean): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:setProjectCollapsed', projectId, collapsed),
    createTask: (projectId: string, name: string, steps: TaskStep[]): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:createTask', projectId, name, steps),
    updateTask: (taskId: string, name: string, steps: TaskStep[]): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:updateTask', taskId, name, steps),
    removeTask: (taskId: string): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:removeTask', taskId)
  },

  project: {
    inspect: (path: string): Promise<ProjectInfo> => ipcRenderer.invoke('project:inspect', path),
    findMissing: (paths: string[]): Promise<string[]> =>
      ipcRenderer.invoke('project:findMissing', paths)
  },

  files: {
    read: (path: string): Promise<DirEntry[]> => ipcRenderer.invoke('files:read', path),
    search: (options: FileSearchOptions): Promise<FileSearchResult> =>
      ipcRenderer.invoke('files:search', options)
  },

  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),

  revealItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:revealItem', path),

  openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open', path),

  pathsFromDrop: (files: File[]): string[] =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),

  onMenuAction: (listener: (action: MenuAction) => void): (() => void) => {
    const handler = (_e: unknown, action: MenuAction): void => listener(action)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },

  onExternalFolderOpened: (listener: (event: ExternalFolderOpened) => void): (() => void) => {
    const handler = (_e: unknown, event: ExternalFolderOpened): void => listener(event)
    ipcRenderer.on('external:folder-opened', handler)
    return () => ipcRenderer.removeListener('external:folder-opened', handler)
  },

  notifyExternalReady: (): void => ipcRenderer.send('external:ready'),

  session: {
    create: (options: SessionOptions): Promise<SessionCreated> =>
      ipcRenderer.invoke('session:create', options),
    write: (id: string, data: string): void => ipcRenderer.send('session:write', id, data),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send('session:resize', id, cols, rows),
    kill: (id: string): void => ipcRenderer.send('session:kill', id),

    onData: (listener: (id: string, data: string) => void): (() => void) => {
      const handler = (_e: unknown, payload: { id: string; data: string }): void =>
        listener(payload.id, payload.data)
      ipcRenderer.on('session:data', handler)
      return () => ipcRenderer.removeListener('session:data', handler)
    },

    onExit: (listener: (id: string, exitCode: number) => void): (() => void) => {
      const handler = (_e: unknown, payload: { id: string; exitCode: number }): void =>
        listener(payload.id, payload.exitCode)
      ipcRenderer.on('session:exit', handler)
      return () => ipcRenderer.removeListener('session:exit', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
