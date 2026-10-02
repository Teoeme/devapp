import { useEffect, useRef, useState } from 'react'
import SeleneLogo from './SeleneLogo'
import type { Folder, Project, Selection, Workspace } from '../../../shared/types'

const DND_TYPE = 'application/devapp-folder'

interface Props {
  workspace: Workspace
  selection: Selection | null
  runningByFolder: Record<string, number>
  missingIds: Set<string>
  ptyWarning: string | null
  onSelect: (selection: Selection) => void
  onAddFolder: () => void
  onCreateProject: (name: string) => void
  onRenameProject: (id: string, name: string) => void
  onRemoveFolder: (id: string) => void
  onRemoveProject: (id: string) => void
  onAssignFolder: (folderId: string, projectId: string | null) => void
  onToggleCollapse: (projectId: string, collapsed: boolean) => void
  onAddToProject: (projectId: string) => void
}

type Editing = { mode: 'new' } | { mode: 'rename'; id: string; value: string } | null

export default function Sidebar({
  workspace,
  selection,
  runningByFolder,
  missingIds,
  ptyWarning,
  onSelect,
  onAddFolder,
  onCreateProject,
  onRenameProject,
  onRemoveFolder,
  onRemoveProject,
  onAssignFolder,
  onToggleCollapse,
  onAddToProject
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState<Editing>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const { projects, folders } = workspace
  const ungrouped = folders.filter((f) => !f.projectId)

  const commitEdit = (value: string): void => {
    const name = value.trim()
    if (name) {
      if (editing?.mode === 'new') onCreateProject(name)
      else if (editing?.mode === 'rename') onRenameProject(editing.id, name)
    }
    setEditing(null)
  }

  const nameInput = (initial: string): React.JSX.Element => (
    <input
      ref={inputRef}
      className="inline-input"
      defaultValue={initial}
      placeholder="Nombre del proyecto"
      spellCheck={false}
      onBlur={(event) => commitEdit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commitEdit(event.currentTarget.value)
        else if (event.key === 'Escape') setEditing(null)
      }}
      onClick={(event) => event.stopPropagation()}
    />
  )

  const dropProps = (
    projectId: string | null,
    key: string
  ): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: (event) => {
      if (!event.dataTransfer.types.includes(DND_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event) => {
      if (!event.dataTransfer.types.includes(DND_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      const folderId = event.dataTransfer.getData(DND_TYPE)
      if (folderId) onAssignFolder(folderId, projectId)
    }
  })

  const folderRow = (folder: Folder, nested: boolean): React.JSX.Element => {
    const running = runningByFolder[folder.id] ?? 0
    const active = selection?.type === 'folder' && selection.id === folder.id
    const classes = [
      'folder-item',
      nested ? 'nested' : '',
      active ? 'active' : '',
      missingIds.has(folder.id) ? 'missing' : ''
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div
        key={folder.id}
        className={classes}
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DND_TYPE, folder.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => onSelect({ type: 'folder', id: folder.id })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSelect({ type: 'folder', id: folder.id })
        }}
        title={folder.path}
      >
        <span className="folder-text">
          <span className="folder-name">{folder.name}</span>
          <span className="folder-path">{folder.path}</span>
        </span>
        {folder.origin === 'external' && missingIds.has(folder.id) && (
          <span className="block-missing">eliminado</span>
        )}
        {running > 0 && <span className="folder-badge">{running}</span>}
        <button
          className="row-action"
          title="Quitar de la lista"
          onClick={(event) => {
            event.stopPropagation()
            onRemoveFolder(folder.id)
          }}
        >
          ×
        </button>
      </div>
    )
  }

  /** Carpetas manuales primero; las abiertas por agentes, aparte bajo su propio rótulo. */
  const folderRows = (list: Folder[], nested: boolean): React.JSX.Element[] => {
    const manualFolders = list.filter((f) => f.origin === 'manual')
    const agentFolders = list.filter((f) => f.origin === 'external')
    return [
      ...manualFolders.map((folder) => folderRow(folder, nested)),
      ...(agentFolders.length > 0
        ? [
            <div key="agents-label" className={`list-label${nested ? ' nested' : ''}`}>
              Agentes
            </div>,
            ...agentFolders.map((folder) => folderRow(folder, nested))
          ]
        : [])
    ]
  }

  const projectRow = (project: Project): React.JSX.Element => {
    const children = folders.filter((f) => f.projectId === project.id)
    const running = children.reduce((sum, f) => sum + (runningByFolder[f.id] ?? 0), 0)
    const active = selection?.type === 'project' && selection.id === project.id
    const collapsed = project.collapsed === true

    return (
      <div key={project.id} className="project-group">
        <div
          className={`project-item${active ? ' active' : ''}${
            dropTarget === project.id ? ' drop' : ''
          }`}
          role="button"
          tabIndex={0}
          onClick={() => onSelect({ type: 'project', id: project.id })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSelect({ type: 'project', id: project.id })
          }}
          {...dropProps(project.id, project.id)}
        >
          <button
            className={`chevron${collapsed ? '' : ' open'}`}
            title={collapsed ? 'Expandir' : 'Contraer'}
            aria-expanded={!collapsed}
            onClick={(event) => {
              event.stopPropagation()
              onToggleCollapse(project.id, !collapsed)
            }}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path
                d="M4.5 2.5 L8.5 6 L4.5 9.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {editing?.mode === 'rename' && editing.id === project.id ? (
            nameInput(project.name)
          ) : (
            <span
              className="project-name"
              onDoubleClick={(event) => {
                event.stopPropagation()
                setEditing({ mode: 'rename', id: project.id, value: project.name })
              }}
            >
              {project.name}
            </span>
          )}

          <span className="project-count">{children.length}</span>
          {running > 0 && <span className="folder-badge">{running}</span>}

          <button
            className="row-action"
            title="Agregar carpeta a este proyecto"
            onClick={(event) => {
              event.stopPropagation()
              onAddToProject(project.id)
            }}
          >
            +
          </button>
          <button
            className="row-action"
            title="Eliminar proyecto (las carpetas quedan sueltas)"
            onClick={(event) => {
              event.stopPropagation()
              onRemoveProject(project.id)
            }}
          >
            ×
          </button>
        </div>

        {!collapsed &&
          (children.length > 0 ? (
            folderRows(children, true)
          ) : (
            <div className="project-empty">Arrastrá carpetas acá o usá +</div>
          ))}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <SeleneLogo />
          <span className="brand-sub">dev</span>
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="btn block sm" onClick={onAddFolder}>
          + Carpeta
        </button>
        <button className="btn block sm" onClick={() => setEditing({ mode: 'new' })}>
          + Proyecto
        </button>
      </div>

      <nav className="folder-list">
        {projects.map(projectRow)}

        {editing?.mode === 'new' && <div className="project-item">{nameInput('')}</div>}

        {ungrouped.length > 0 && (
          <>
            {projects.length > 0 && (
              <div
                className={`list-label${dropTarget === '__none__' ? ' drop' : ''}`}
                {...dropProps(null, '__none__')}
              >
                Sin proyecto
              </div>
            )}
            {folderRows(ungrouped, false)}
          </>
        )}
      </nav>

      {ptyWarning && (
        <div className="sidebar-foot">
          <span className="warn">⚠ Terminal en modo limitado</span>
          <br />
          Ejecutá <code>npm run rebuild</code>
        </div>
      )}
    </aside>
  )
}
