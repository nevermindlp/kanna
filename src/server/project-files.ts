import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ProjectFileTreeNode } from "../shared/types"
import type { IUserScopedEventStore } from "./event-store-types"
import { inferProjectFileContentType } from "./uploads"

export const IGNORED_DIRS = new Set([
  "node_modules", "dist", "build", ".next", ".nuxt", ".cache", ".parcel-cache",
  ".git", ".svn", ".hg",
  "__pycache__", ".pytest_cache", ".mypy_cache", ".tox", "venv", ".venv",
  "target", "vendor",
  ".gradle", ".idea", "coverage", ".nyc_output",
  ".kanna",
])

const DEFAULT_FS_CONCURRENCY = 64
const parsedFsConcurrency = Number.parseInt(process.env.FS_CONCURRENCY ?? "", 10)
const FS_CONCURRENCY = Number.isFinite(parsedFsConcurrency) && parsedFsConcurrency > 0
  ? parsedFsConcurrency
  : DEFAULT_FS_CONCURRENCY

let activeFsOperations = 0
const pendingFsOperations: Array<() => void> = []

async function acquireFsSlot() {
  if (activeFsOperations < FS_CONCURRENCY) {
    activeFsOperations += 1
    return
  }
  await new Promise<void>((resolve) => {
    pendingFsOperations.push(resolve)
  })
  activeFsOperations += 1
}

function releaseFsSlot() {
  activeFsOperations = Math.max(0, activeFsOperations - 1)
  const next = pendingFsOperations.shift()
  if (next) next()
}

function permToRwx(bits: number) {
  const read = bits & 4 ? "r" : "-"
  const write = bits & 2 ? "w" : "-"
  const exec = bits & 1 ? "x" : "-"
  return `${read}${write}${exec}`
}

export type PathValidationResult =
  | { ok: true; resolved: string; projectRoot: string }
  | { ok: false; error: string; status: number }

export function resolvePathInProject(projectRoot: string, targetPath: string): PathValidationResult {
  const normalizedRoot = path.resolve(projectRoot)
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(normalizedRoot, targetPath)

  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return { ok: false, error: "Path must be under project root", status: 403 }
  }

  return { ok: true, resolved, projectRoot: normalizedRoot }
}

export function validateFilename(name: string): { ok: true } | { ok: false; error: string } {
  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, error: "Filename cannot be empty" }
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(trimmed)) {
    return { ok: false, error: "Filename contains invalid characters" }
  }
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(trimmed)) {
    return { ok: false, error: "Filename is a reserved name" }
  }
  if (/^\.+$/.test(trimmed)) {
    return { ok: false, error: "Filename cannot be only dots" }
  }
  return { ok: true }
}

function isProtectedKannaPath(resolved: string, projectRoot: string) {
  const relative = path.relative(projectRoot, resolved)
  if (relative.startsWith("..")) return true
  if (!relative || relative === ".") return false
  const segments = relative.split(path.sep)
  return segments[0] === ".kanna"
}

export async function getFileTree(
  dirPath: string,
  maxDepth = 10,
  currentDepth = 0,
): Promise<ProjectFileTreeNode[]> {
  let entries
  try {
    await acquireFsSlot()
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } finally {
      releaseFsSlot()
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
    if (code !== "EACCES" && code !== "EPERM") {
      console.error("Error reading directory:", error)
    }
    return []
  }

  const filtered = entries.filter((entry) => !(entry.isDirectory() && IGNORED_DIRS.has(entry.name)))

  const items = await Promise.all(filtered.map(async (entry) => {
    const itemPath = path.join(dirPath, entry.name)
    const item: ProjectFileTreeNode = {
      name: entry.name,
      path: itemPath,
      type: entry.isDirectory() ? "directory" : "file",
    }

    try {
      await acquireFsSlot()
      try {
        const stats = await lstat(itemPath)
        item.size = stats.size
        item.modified = stats.mtime.toISOString()
        if (stats.isSymbolicLink()) {
          item.isSymlink = true
        }
        const mode = stats.mode
        const ownerPerm = (mode >> 6) & 7
        const groupPerm = (mode >> 3) & 7
        const otherPerm = mode & 7
        item.permissions = `${ownerPerm}${groupPerm}${otherPerm}`
        item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm)
      } finally {
        releaseFsSlot()
      }
    } catch {
      item.size = 0
      item.modified = null
      item.permissions = "000"
      item.permissionsRwx = "---------"
    }

    if (entry.isDirectory() && currentDepth < maxDepth) {
      item.children = await getFileTree(itemPath, maxDepth, currentDepth + 1)
    }

    return item
  }))

  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

export function contentDispositionAttachment(fileName: string) {
  const fallbackName = fileName.replace(/[^\x20-\x7E]+/g, "_") || "download"
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function getProjectFromStore(store: IUserScopedEventStore, projectId: string): { project: NonNullable<ReturnType<IUserScopedEventStore["getProject"]>> } | { error: Response } {
  const project = store.getProject(projectId)
  if (!project) {
    return { error: Response.json({ error: "Project not found" }, { status: 404 }) }
  }
  return { project }
}

export async function handleProjectFilesRequest(
  req: Request,
  url: URL,
  store: IUserScopedEventStore,
): Promise<Response | null> {
  const listMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files$/)
  if (listMatch && req.method === "GET") {
    const lookup = getProjectFromStore(store, listMatch[1])
    if ("error" in lookup) return lookup.error

    const depthParam = url.searchParams.get("depth")
    const depth = depthParam ? Math.min(20, Math.max(1, Number.parseInt(depthParam, 10) || 10)) : 10

    try {
      await acquireFsSlot()
      try {
        await lstat(lookup.project.localPath)
      } finally {
        releaseFsSlot()
      }
    } catch {
      return Response.json({ error: "Project path not found" }, { status: 404 })
    }

    const files = await getFileTree(path.resolve(lookup.project.localPath), depth, 0)
    return Response.json(files)
  }

  const readMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/file$/)
  if (readMatch && req.method === "GET") {
    const lookup = getProjectFromStore(store, readMatch[1])
    if ("error" in lookup) return lookup.error

    const filePath = url.searchParams.get("path")
    if (!filePath) {
      return Response.json({ error: "Invalid file path" }, { status: 400 })
    }

    const resolved = resolvePathInProject(lookup.project.localPath, filePath)
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: resolved.status })
    }

    try {
      const content = await readFile(resolved.resolved, "utf8")
      return Response.json({ content, path: resolved.resolved })
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (code === "ENOENT") return Response.json({ error: "File not found" }, { status: 404 })
      if (code === "EACCES" || code === "EPERM") return Response.json({ error: "Permission denied" }, { status: 403 })
      if (code === "EISDIR") return Response.json({ error: "Path is a directory" }, { status: 400 })
      return Response.json({ error: error instanceof Error ? error.message : "Read failed" }, { status: 500 })
    }
  }

  if (readMatch && req.method === "PUT") {
    const lookup = getProjectFromStore(store, readMatch[1])
    if ("error" in lookup) return lookup.error

    let body: { filePath?: string; content?: string }
    try {
      body = await req.json() as { filePath?: string; content?: string }
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body.filePath || typeof body.content !== "string") {
      return Response.json({ error: "filePath and content are required" }, { status: 400 })
    }

    const resolved = resolvePathInProject(lookup.project.localPath, body.filePath)
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: resolved.status })
    }
    if (isProtectedKannaPath(resolved.resolved, resolved.projectRoot)) {
      return Response.json({ error: "Cannot modify files under .kanna" }, { status: 403 })
    }

    try {
      await writeFile(resolved.resolved, body.content, "utf8")
      return Response.json({ ok: true, path: resolved.resolved })
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (code === "ENOENT") return Response.json({ error: "File not found" }, { status: 404 })
      if (code === "EACCES" || code === "EPERM") return Response.json({ error: "Permission denied" }, { status: 403 })
      return Response.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 500 })
    }
  }

  const createMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/create$/)
  if (createMatch && req.method === "POST") {
    const lookup = getProjectFromStore(store, createMatch[1])
    if ("error" in lookup) return lookup.error

    let body: { path?: string; name?: string; type?: "file" | "directory" }
    try {
      body = await req.json() as { path?: string; name?: string; type?: "file" | "directory" }
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body.name || (body.type !== "file" && body.type !== "directory")) {
      return Response.json({ error: "name and type are required" }, { status: 400 })
    }

    const nameCheck = validateFilename(body.name)
    if (!nameCheck.ok) {
      return Response.json({ error: nameCheck.error }, { status: 400 })
    }

    const parentPath = body.path?.trim() || lookup.project.localPath
    const parentResolved = resolvePathInProject(lookup.project.localPath, parentPath)
    if (!parentResolved.ok) {
      return Response.json({ error: parentResolved.error }, { status: parentResolved.status })
    }
    if (isProtectedKannaPath(parentResolved.resolved, parentResolved.projectRoot)) {
      return Response.json({ error: "Cannot create files under .kanna" }, { status: 403 })
    }

    const targetPath = path.join(parentResolved.resolved, body.name)
    const targetResolved = resolvePathInProject(lookup.project.localPath, targetPath)
    if (!targetResolved.ok) {
      return Response.json({ error: targetResolved.error }, { status: targetResolved.status })
    }

    try {
      if (body.type === "directory") {
        await mkdir(targetResolved.resolved, { recursive: false })
      } else {
        await writeFile(targetResolved.resolved, "", { flag: "wx" })
      }
      return Response.json({ ok: true, path: targetResolved.resolved })
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (code === "EEXIST") return Response.json({ error: "Path already exists" }, { status: 409 })
      return Response.json({ error: error instanceof Error ? error.message : "Create failed" }, { status: 500 })
    }
  }

  const renameMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/rename$/)
  if (renameMatch && req.method === "PUT") {
    const lookup = getProjectFromStore(store, renameMatch[1])
    if ("error" in lookup) return lookup.error

    let body: { oldPath?: string; newName?: string }
    try {
      body = await req.json() as { oldPath?: string; newName?: string }
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body.oldPath || !body.newName) {
      return Response.json({ error: "oldPath and newName are required" }, { status: 400 })
    }

    const nameCheck = validateFilename(body.newName)
    if (!nameCheck.ok) {
      return Response.json({ error: nameCheck.error }, { status: 400 })
    }

    const oldResolved = resolvePathInProject(lookup.project.localPath, body.oldPath)
    if (!oldResolved.ok) {
      return Response.json({ error: oldResolved.error }, { status: oldResolved.status })
    }
    if (isProtectedKannaPath(oldResolved.resolved, oldResolved.projectRoot)) {
      return Response.json({ error: "Cannot rename files under .kanna" }, { status: 403 })
    }

    const newPath = path.join(path.dirname(oldResolved.resolved), body.newName)
    const newResolved = resolvePathInProject(lookup.project.localPath, newPath)
    if (!newResolved.ok) {
      return Response.json({ error: newResolved.error }, { status: newResolved.status })
    }

    try {
      await rename(oldResolved.resolved, newResolved.resolved)
      return Response.json({ ok: true, path: newResolved.resolved })
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (code === "ENOENT") return Response.json({ error: "Path not found" }, { status: 404 })
      if (code === "EEXIST") return Response.json({ error: "Target already exists" }, { status: 409 })
      return Response.json({ error: error instanceof Error ? error.message : "Rename failed" }, { status: 500 })
    }
  }

  const downloadMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/download$/)
  if (downloadMatch && req.method === "GET") {
    const lookup = getProjectFromStore(store, downloadMatch[1])
    if ("error" in lookup) return lookup.error

    const filePath = url.searchParams.get("path")
    if (!filePath) {
      return Response.json({ error: "Invalid file path" }, { status: 400 })
    }

    const resolved = resolvePathInProject(lookup.project.localPath, filePath)
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: resolved.status })
    }
    if (isProtectedKannaPath(resolved.resolved, resolved.projectRoot)) {
      return Response.json({ error: "Cannot download files under .kanna" }, { status: 403 })
    }

    try {
      const info = await stat(resolved.resolved)
      if (!info.isFile()) {
        return Response.json({ error: "Path is not a file" }, { status: 400 })
      }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (code === "ENOENT") return Response.json({ error: "File not found" }, { status: 404 })
      return Response.json({ error: error instanceof Error ? error.message : "Download failed" }, { status: 500 })
    }

    const file = Bun.file(resolved.resolved)
    const fileName = path.basename(resolved.resolved)
    return new Response(file, {
      headers: {
        "Content-Type": inferProjectFileContentType(fileName, file.type),
        "Content-Disposition": contentDispositionAttachment(fileName),
        "Cache-Control": "no-store",
      },
    })
  }

  const uploadMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/upload$/)
  if (uploadMatch && req.method === "POST") {
    const lookup = getProjectFromStore(store, uploadMatch[1])
    if ("error" in lookup) return lookup.error

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json({ error: "Invalid multipart body" }, { status: 400 })
    }

    const targetPath = String(formData.get("targetPath") ?? "")
    let relativePaths: string[] = []
    const relativePathsField = formData.get("relativePaths")
    if (relativePathsField) {
      try {
        relativePaths = JSON.parse(String(relativePathsField)) as string[]
      } catch {
        return Response.json({ error: "Invalid relativePaths JSON" }, { status: 400 })
      }
    }

    const projectRoot = path.resolve(lookup.project.localPath)
    let resolvedTargetDir: string
    if (!targetPath || targetPath === "." || targetPath === "./") {
      resolvedTargetDir = projectRoot
    } else {
      const validation = resolvePathInProject(projectRoot, targetPath)
      if (!validation.ok) {
        return Response.json({ error: validation.error }, { status: validation.status })
      }
      resolvedTargetDir = validation.resolved
    }

    if (isProtectedKannaPath(resolvedTargetDir, projectRoot)) {
      return Response.json({ error: "Cannot upload files under .kanna" }, { status: 403 })
    }

    try {
      await mkdir(resolvedTargetDir, { recursive: true })
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Failed to prepare target directory" }, { status: 500 })
    }

    const fileEntries = formData.getAll("files")
    const uploadedFiles: Array<{ name: string; path: string; size: number }> = []

    for (let index = 0; index < fileEntries.length; index += 1) {
      const entry = fileEntries[index]
      if (typeof entry !== "object" || entry === null || typeof entry.arrayBuffer !== "function") {
        continue
      }

      const fileName = relativePaths[index] || ("name" in entry && typeof entry.name === "string" ? entry.name : `upload-${index}`)
      const destPath = path.join(resolvedTargetDir, fileName)
      const destValidation = resolvePathInProject(projectRoot, destPath)
      if (!destValidation.ok) continue
      if (isProtectedKannaPath(destValidation.resolved, projectRoot)) continue

      try {
        await mkdir(path.dirname(destValidation.resolved), { recursive: true })
        await writeFile(destValidation.resolved, Buffer.from(await entry.arrayBuffer()))
        uploadedFiles.push({
          name: fileName,
          path: destValidation.resolved,
          size: "size" in entry && typeof entry.size === "number" ? entry.size : 0,
        })
      } catch (error) {
        console.error("Failed to upload file:", fileName, error)
      }
    }

    if (fileEntries.length > 0 && uploadedFiles.length === 0) {
      return Response.json({ error: "No files could be uploaded to this location" }, { status: 400 })
    }

    return Response.json({
      success: true,
      files: uploadedFiles,
      uploadedCount: uploadedFiles.length,
      requestedFileCount: fileEntries.length,
      targetPath: resolvedTargetDir,
    })
  }

  if (listMatch && req.method === "DELETE") {
    const lookup = getProjectFromStore(store, listMatch[1])
    if ("error" in lookup) return lookup.error

    let body: { path?: string; type?: "file" | "directory" }
    try {
      body = await req.json() as { path?: string; type?: "file" | "directory" }
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body.path || (body.type !== "file" && body.type !== "directory")) {
      return Response.json({ error: "path and type are required" }, { status: 400 })
    }

    const resolved = resolvePathInProject(lookup.project.localPath, body.path)
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: resolved.status })
    }
    if (isProtectedKannaPath(resolved.resolved, resolved.projectRoot)) {
      return Response.json({ error: "Cannot delete files under .kanna" }, { status: 403 })
    }

    try {
      await rm(resolved.resolved, {
        recursive: body.type === "directory",
        force: false,
      })
      return Response.json({ ok: true })
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (code === "ENOENT") return Response.json({ error: "Path not found" }, { status: 404 })
      if (code === "ENOTEMPTY") return Response.json({ error: "Directory is not empty" }, { status: 409 })
      return Response.json({ error: error instanceof Error ? error.message : "Delete failed" }, { status: 500 })
    }
  }

  return null
}
