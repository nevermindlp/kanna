import type { ProjectFileTreeNode } from "../../shared/types"
import { triggerBlobDownload } from "./downloadBlob"

async function readErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    if (response.status === 404) {
      return "Upload API not found. Restart the Kanna server and try again."
    }
    return response.statusText || "Request failed"
  }
  try {
    const data = await response.json() as { error?: string }
    return data.error ?? response.statusText
  } catch {
    return response.statusText
  }
}

export async function listProjectFiles(projectId: string, depth = 10, signal?: AbortSignal): Promise<ProjectFileTreeNode[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files?depth=${depth}`, { signal })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<ProjectFileTreeNode[]>
}

export async function readProjectFileText(projectId: string, filePath: string, signal?: AbortSignal): Promise<string> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(filePath)}`
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  const data = await response.json() as { content: string }
  return data.content
}

export async function saveProjectFileText(projectId: string, filePath: string, content: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath, content }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
}

export async function createProjectPath(
  projectId: string,
  args: { path: string; name: string; type: "file" | "directory" },
): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
}

export async function renameProjectPath(
  projectId: string,
  args: { oldPath: string; newName: string },
): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
}

export async function deleteProjectPath(
  projectId: string,
  args: { path: string; type: "file" | "directory" },
): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
}

export async function uploadProjectFiles(
  projectId: string,
  files: File[],
  options: { targetPath?: string; relativePaths?: string[] } = {},
): Promise<{ uploadedCount: number }> {
  const formData = new FormData()
  formData.append("targetPath", options.targetPath ?? "")
  if (options.relativePaths?.length) {
    formData.append("relativePaths", JSON.stringify(options.relativePaths))
  }
  files.forEach((file) => {
    formData.append("files", file)
  })

  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/upload`, {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  })
  const contentType = response.headers.get("content-type") ?? ""
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  if (!contentType.includes("application/json")) {
    throw new Error("Upload API not found. Restart the Kanna server and try again.")
  }
  const data = await response.json() as { uploadedCount?: number; error?: string }
  if (data.error) {
    throw new Error(data.error)
  }
  const uploadedCount = data.uploadedCount ?? 0
  if (uploadedCount === 0 && files.length > 0) {
    throw new Error("No files were uploaded")
  }
  return { uploadedCount }
}

export function projectFileDownloadUrl(projectId: string, filePath: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/files/download?path=${encodeURIComponent(filePath)}`
}

export async function fetchProjectFileBlob(projectId: string, filePath: string): Promise<ArrayBuffer> {
  const response = await fetch(projectFileDownloadUrl(projectId, filePath), {
    credentials: "same-origin",
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.arrayBuffer()
}

export async function downloadProjectFile(
  projectId: string,
  filePath: string,
  fileName?: string,
): Promise<void> {
  const blob = await fetch(projectFileDownloadUrl(projectId, filePath), {
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(await readErrorMessage(response))
    }
    return response.blob()
  })
  const resolvedName = fileName ?? filePath.split(/[/\\]/).pop() ?? "download"
  triggerBlobDownload(blob, resolvedName)
}

export function projectFileContentUrl(projectId: string, relativePath: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(relativePath)}/content`
}
