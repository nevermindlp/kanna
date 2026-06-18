import { useCallback, useEffect, useMemo, useState } from "react"
import type { ProjectFileTreeNode } from "../../../shared/types"
import { collectExpandedDirectoryPaths, filterFileTree } from "../fileTreeUtils"
import { useFilesStore } from "../../../stores/filesStore"

export function useFileTreeSearch(projectId: string, files: ProjectFileTreeNode[]) {
  const [searchQuery, setSearchQuery] = useState("")
  const setExpandedDirs = useFilesStore((state) => state.setExpandedDirs)

  const filteredFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return files
    return filterFileTree(files, query)
  }, [files, searchQuery])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) return
    const paths = collectExpandedDirectoryPaths(filteredFiles)
    const expanded: Record<string, boolean> = {}
    paths.forEach((dirPath) => {
      expanded[dirPath] = true
    })
    setExpandedDirs(projectId, expanded)
  }, [filteredFiles, projectId, searchQuery, setExpandedDirs])

  const clearSearch = useCallback(() => setSearchQuery(""), [])

  return {
    searchQuery,
    setSearchQuery,
    filteredFiles,
    clearSearch,
    isSearching: searchQuery.trim().length > 0,
  }
}
