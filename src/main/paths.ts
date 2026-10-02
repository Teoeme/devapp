import { statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export async function isDirectoryAsync(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Ruta absoluta y sin separador final: la forma en que se guardan y comparan las carpetas. */
export function normalizeFolderPath(path: string, baseDir: string = process.cwd()): string {
  return resolve(baseDir, path)
}
