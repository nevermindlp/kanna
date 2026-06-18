import { useCallback, useState } from "react"
import {
  createProjectPath,
  deleteProjectPath,
  renameProjectPath,
} from "../../../lib/projectFilesApi"
import { useAppDialog } from "../../ui/app-dialog"
import { resolveRenamedPath, validateFilename } from "../fileTreeValidation"
import type { ProjectFileTreeNode } from "../../../../shared/types"

export type CreatingNodeState = {
  parentPath: string
  type: "file" | "directory"
} | null

export type RenamingNodeState = {
  path: string
  name: string
  type: "file" | "directory"
} | null

interface UseFileTreeOperationsOptions {
  onRenamed?: (args: {
    oldPath: string
    newPath: string
    newName: string
    type: "file" | "directory"
  }) => void
  onDeleted?: (path: string) => void
}

export function useFileTreeOperations(
  projectId: string,
  onRefresh: () => void,
  options: UseFileTreeOperationsOptions = {},
) {
  const dialog = useAppDialog()
  const [creatingNode, setCreatingNode] = useState<CreatingNodeState>(null)
  const [renamingNode, setRenamingNode] = useState<RenamingNodeState>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)

  const startCreate = useCallback((parentPath: string, type: "file" | "directory") => {
    setCreateError(null)
    setRenamingNode(null)
    setCreatingNode({ parentPath, type })
  }, [])

  const cancelCreate = useCallback(() => {
    setCreatingNode(null)
    setCreateError(null)
  }, [])

  const confirmCreate = useCallback(async (name: string) => {
    if (!creatingNode) return false
    const validationError = validateFilename(name)
    if (validationError) {
      setCreateError(validationError)
      return false
    }

    setIsCreating(true)
    setCreateError(null)
    try {
      await createProjectPath(projectId, {
        path: creatingNode.parentPath,
        name: name.trim(),
        type: creatingNode.type,
      })
      setCreatingNode(null)
      onRefresh()
      return true
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Create failed")
      return false
    } finally {
      setIsCreating(false)
    }
  }, [creatingNode, onRefresh, projectId])

  const startRename = useCallback((node: Pick<ProjectFileTreeNode, "path" | "name" | "type">) => {
    setCreatingNode(null)
    setRenameError(null)
    setRenamingNode({ path: node.path, name: node.name, type: node.type })
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingNode(null)
    setRenameError(null)
  }, [])

  const confirmRename = useCallback(async (newName: string) => {
    if (!renamingNode) return false
    const trimmed = newName.trim()
    const validationError = validateFilename(trimmed)
    if (validationError) {
      setRenameError(validationError)
      return false
    }

    if (trimmed === renamingNode.name) {
      cancelRename()
      return true
    }

    setIsRenaming(true)
    setRenameError(null)
    try {
      await renameProjectPath(projectId, {
        oldPath: renamingNode.path,
        newName: trimmed,
      })
      const newPath = resolveRenamedPath(renamingNode.path, trimmed)
      options.onRenamed?.({
        oldPath: renamingNode.path,
        newPath,
        newName: trimmed,
        type: renamingNode.type,
      })
      setRenamingNode(null)
      onRefresh()
      return true
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Rename failed")
      return false
    } finally {
      setIsRenaming(false)
    }
  }, [cancelRename, onRefresh, options, projectId, renamingNode])

  const deleteNode = useCallback(async (node: Pick<ProjectFileTreeNode, "path" | "name" | "type">) => {
    const ok = await dialog.confirm({
      title: node.type === "directory" ? "Delete folder?" : "Delete file?",
      description: `"${node.name}" will be permanently deleted.`,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
    })
    if (!ok) return false

    setIsDeleting(true)
    try {
      await deleteProjectPath(projectId, { path: node.path, type: node.type })
      options.onDeleted?.(node.path)
      onRefresh()
      return true
    } catch (error) {
      await dialog.alert({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Could not delete item",
      })
      return false
    } finally {
      setIsDeleting(false)
    }
  }, [dialog, onRefresh, options, projectId])

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      await dialog.alert({
        title: "Copy failed",
        description: "Could not copy path to clipboard.",
      })
    }
  }, [dialog])

  return {
    creatingNode,
    renamingNode,
    isCreating,
    isRenaming,
    isDeleting,
    createError,
    renameError,
    startCreate,
    cancelCreate,
    confirmCreate,
    startRename,
    cancelRename,
    confirmRename,
    deleteNode,
    copyPath,
  }
}
