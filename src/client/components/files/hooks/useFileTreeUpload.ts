import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { uploadProjectFiles } from "../../../lib/projectFilesApi"

export function useFileTreeUpload(projectId: string, onRefresh: () => void) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [uploadTargetPath, setUploadTargetPath] = useState("")

  const uploadFiles = useCallback(async (fileList: FileList | File[], targetPath = "") => {
    const files = Array.from(fileList)
    if (files.length === 0) return

    setIsUploading(true)
    setUploadError(null)
    try {
      const relativePaths = files.map((file) => {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
        return relative || file.name
      })
      await uploadProjectFiles(projectId, files, { targetPath, relativePaths })
      onRefresh()
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed")
    } finally {
      setIsUploading(false)
      setDropTargetPath(null)
    }
  }, [onRefresh, projectId])

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target
    if (files && files.length > 0) {
      void uploadFiles(files, uploadTargetPath)
    }
    event.target.value = ""
    setUploadTargetPath("")
  }, [uploadFiles, uploadTargetPath])

  const handleFolderInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target
    if (files && files.length > 0) {
      void uploadFiles(files, uploadTargetPath)
    }
    event.target.value = ""
    setUploadTargetPath("")
  }, [uploadFiles, uploadTargetPath])

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setIsDragOver(false)
    setDropTargetPath(null)
  }, [])

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    const targetPath = dropTargetPath ?? ""
    setDropTargetPath(null)
    if (event.dataTransfer.files.length > 0) {
      void uploadFiles(event.dataTransfer.files, targetPath)
    }
  }, [dropTargetPath, uploadFiles])

  const handleFolderDragOver = useCallback((event: DragEvent, folderPath: string) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
    setDropTargetPath(folderPath)
  }, [])

  const handleFolderDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setDropTargetPath(null)
  }, [])

  const handleFolderDrop = useCallback((event: DragEvent, folderPath: string) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    setDropTargetPath(null)
    if (event.dataTransfer.files.length > 0) {
      void uploadFiles(event.dataTransfer.files, folderPath)
    }
  }, [uploadFiles])

  const openFilePicker = useCallback((targetPath = "") => {
    setUploadTargetPath(targetPath)
    fileInputRef.current?.click()
  }, [])

  const openFolderPicker = useCallback((targetPath = "") => {
    setUploadTargetPath(targetPath)
    folderInputRef.current?.click()
  }, [])

  return {
    fileInputRef,
    folderInputRef,
    isUploading,
    uploadError,
    isDragOver,
    dropTargetPath,
    handleFileInputChange,
    handleFolderInputChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    openFilePicker,
    openFolderPicker,
  }
}
