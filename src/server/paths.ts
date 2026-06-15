import { mkdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

export function resolveLocalPath(localPath: string) {
  const trimmed = localPath.trim()
  if (!trimmed) {
    throw new Error("Project path is required")
  }
  if (trimmed === "~") {
    return homedir()
  }
  if (trimmed.startsWith("~/")) {
    return path.join(homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

export async function ensureProjectDirectory(localPath: string) {
  const resolvedPath = resolveLocalPath(localPath)

  await mkdir(resolvedPath, { recursive: true })
  const info = await stat(resolvedPath)
  if (!info.isDirectory()) {
    throw new Error("Project path must be a directory")
  }
}

export async function assertProjectDirectoryExists(localPath: string) {
  const resolvedPath = resolveLocalPath(localPath)
  try {
    const info = await stat(resolvedPath)
    if (!info.isDirectory()) {
      throw new Error(`Project path is not a directory: ${resolvedPath}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Project directory does not exist: ${resolvedPath}. Open or create the project with a valid path on this machine.`,
      )
    }
    throw error
  }
}

export function getProjectUploadDir(localPath: string) {
  return path.join(resolveLocalPath(localPath), ".kanna", "uploads")
}

export function getProjectExportDir(localPath: string) {
  return path.join(resolveLocalPath(localPath), ".kanna", "exports")
}
