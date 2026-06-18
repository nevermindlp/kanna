import { useCallback, useState } from "react"
import JSZip from "jszip"
import type { ProjectFileTreeNode } from "../../../../shared/types"
import { downloadProjectFile, fetchProjectFileBlob } from "../../../lib/projectFilesApi"
import { triggerBlobDownload } from "../../../lib/downloadBlob"

export function useFileTreeDownload(projectId: string) {
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const downloadFile = useCallback(async (filePath: string, fileName: string) => {
    setDownloadingPath(filePath)
    setDownloadError(null)
    try {
      await downloadProjectFile(projectId, filePath, fileName)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed")
    } finally {
      setDownloadingPath(null)
    }
  }, [projectId])

  const downloadFolder = useCallback(async (folder: ProjectFileTreeNode) => {
    setDownloadingPath(folder.path)
    setDownloadError(null)
    try {
      const zip = new JSZip()

      const collectFiles = async (node: ProjectFileTreeNode, currentPath: string) => {
        const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name
        if (node.type === "file") {
          const fileBytes = await fetchProjectFileBlob(projectId, node.path)
          zip.file(fullPath, fileBytes)
        } else if (node.type === "directory" && node.children) {
          for (const child of node.children) {
            await collectFiles(child, fullPath)
          }
        }
      }

      if (folder.children && folder.children.length > 0) {
        for (const child of folder.children) {
          await collectFiles(child, "")
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" })
      triggerBlobDownload(zipBlob, `${folder.name}.zip`)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed")
    } finally {
      setDownloadingPath(null)
    }
  }, [projectId])

  const clearDownloadError = useCallback(() => setDownloadError(null), [])

  return {
    downloadingPath,
    downloadError,
    downloadFile,
    downloadFolder,
    clearDownloadError,
  }
}
