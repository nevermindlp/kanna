import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectFileTreeNode } from "../../../../shared/types"
import { listProjectFiles } from "../../../lib/projectFilesApi"

export function useFileTreeData(projectId: string | undefined) {
  const [files, setFiles] = useState<ProjectFileTreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const refreshFiles = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!projectId) {
      setFiles([])
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let active = true

    void (async () => {
      setLoading(true)
      try {
        const tree = await listProjectFiles(projectId, 10, controller.signal)
        if (active) setFiles(tree)
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return
        console.error("Failed to load project files:", error)
        if (active) setFiles([])
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [projectId, refreshKey])

  return { files, loading, refreshFiles }
}
