import { useState } from 'react'
import { runNodeFileCommand, runScriptCommand } from '../../../shared/commands'
import type { Folder, PackageManager, ProjectInfo } from '../../../shared/types'

export interface PanelEntry {
  folder: Folder
  info: ProjectInfo | null
}

interface Props {
  entries: PanelEntry[]
  /** En un proyecto mostramos de qué carpeta es cada bloque. */
  showFolderNames: boolean
  onRun: (folder: Folder, command: string, title: string, cwd?: string) => void
  onOpenTerminal: (folder: Folder) => void
}

/** Un package.json con scripts: el de la raíz o el de una subcarpeta. */
interface ScriptSource {
  /** Ruta relativa a la carpeta abierta; `''` es la raíz. */
  relDir: string
  label: string
  /** Ruta desde la carpeta abierta hasta el package.json. */
  location: string
  cwd: string
  packageManager: PackageManager | null
  scripts: [string, string][]
}

const ROOT_REL_DIR = ''

/** Pestaña con la carpeta padre del package.json; si está más abajo, `…/carpeta`. */
function subpackageLabel(relDir: string): string {
  const segments = relDir.split('/')
  const parentName = segments[segments.length - 1]
  return segments.length > 1 ? `…/${parentName}` : parentName
}

function scriptSources(folder: Folder, info: ProjectInfo | null): ScriptSource[] {
  if (!info) return []
  const sources: ScriptSource[] = info.subpackages.map((pkg) => ({
    relDir: pkg.relDir,
    label: subpackageLabel(pkg.relDir),
    location: `${folder.name}/${pkg.relDir}`,
    cwd: pkg.path,
    packageManager: pkg.packageManager,
    scripts: Object.entries(pkg.scripts)
  }))
  const rootScripts = Object.entries(info.scripts)
  if (rootScripts.length === 0) return sources
  return [
    {
      relDir: ROOT_REL_DIR,
      label: folder.name,
      location: folder.name,
      cwd: folder.path,
      packageManager: info.packageManager,
      scripts: rootScripts
    },
    ...sources
  ]
}

function FolderBlock({
  folder,
  info,
  showName,
  onRun,
  onOpenTerminal
}: PanelEntry & {
  showName: boolean
  onRun: Props['onRun']
  onOpenTerminal: Props['onOpenTerminal']
}): React.JSX.Element {
  const [command, setCommand] = useState('')
  const [selectedRelDir, setSelectedRelDir] = useState(ROOT_REL_DIR)

  const sources = scriptSources(folder, info)
  // Si la pestaña elegida desaparece al re-inspeccionar, se vuelve a la primera.
  const source = sources.find((candidate) => candidate.relDir === selectedRelDir) ?? sources[0]
  const nodeFiles = info?.nodeFiles ?? []

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = command.trim()
    if (!trimmed) return
    onRun(folder, trimmed, trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed)
    setCommand('')
  }

  return (
    <div className="panel-block">
      {showName && (
        <div className="block-head">
          <span className="block-name">{folder.name}</span>
          {info?.branch && <span className="chip-branch">⎇ {info.branch}</span>}
          {info?.packageManager && <span className="block-meta">{info.packageManager}</span>}
          {info && !info.exists && <span className="block-missing">no encontrada</span>}
          <button className="btn ghost sm" onClick={() => onOpenTerminal(folder)}>
            Terminal acá
          </button>
        </div>
      )}

      {source && (
        <div className="panel-row">
          {!showName && (
            <div className="panel-label">
              Scripts de package.json {source.packageManager && `· ${source.packageManager}`}
            </div>
          )}
          {sources.length > 1 && (
            <div className="pkg-tabs" role="group" aria-label="Carpetas con scripts">
              {sources.map((tab) => (
                <button
                  key={tab.relDir}
                  type="button"
                  className={`pkg-tab${tab === source ? ' active' : ''}`}
                  aria-pressed={tab === source}
                  title={tab.location}
                  onClick={() => setSelectedRelDir(tab.relDir)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          <div className="chips">
            {source.scripts.map(([name, script]) => {
              const cmd = runScriptCommand(source.packageManager, name)
              const title = source.relDir === ROOT_REL_DIR ? cmd : `${source.label} · ${cmd}`
              return (
                <button
                  key={name}
                  className="chip"
                  title={script}
                  onClick={() => onRun(folder, cmd, title, source.cwd)}
                >
                  <span className="play">▶</span>
                  {name}
                  <code>{script}</code>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {nodeFiles.length > 0 && (
        <div className="panel-row">
          {!showName && <div className="panel-label">Archivos ejecutables con node</div>}
          <div className="chips">
            {nodeFiles.map((file) => {
              const cmd = runNodeFileCommand(file)
              return (
                <button
                  key={file}
                  className="chip"
                  title={cmd}
                  onClick={() => onRun(folder, cmd, file)}
                >
                  <span className="play">▶</span>
                  {file}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {sources.length === 0 && nodeFiles.length === 0 && (
        <div className="panel-row panel-empty">
          Sin <code>package.json</code> ni archivos <code>.js</code> en la raíz.
        </div>
      )}

      <div className="panel-row">
        <form className="cmd-form" onSubmit={submit}>
          <input
            className="cmd-input"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={`Ejecutar un comando en ${folder.name}…`}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button className="btn primary sm" type="submit" disabled={!command.trim()}>
            Ejecutar
          </button>
        </form>
      </div>
    </div>
  )
}

export default function ProjectPanel({
  entries,
  showFolderNames,
  onRun,
  onOpenTerminal
}: Props): React.JSX.Element {
  return (
    <section className="panel">
      {entries.map((entry) => (
        <FolderBlock
          key={entry.folder.id}
          folder={entry.folder}
          info={entry.info}
          showName={showFolderNames}
          onRun={onRun}
          onOpenTerminal={onOpenTerminal}
        />
      ))}
    </section>
  )
}
