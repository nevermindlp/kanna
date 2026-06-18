import { useShallow } from "zustand/react/shallow"
import { create } from "zustand"
import { persist } from "zustand/middleware"

export type MainContentView = "chat" | "files"

export interface EditingFileState {
  name: string
  path: string
  projectId: string
}

interface ProjectFilesUiState {
  expandedDirs: Record<string, boolean>
  editingFile: EditingFileState | null
  editorWidth: number
}

interface FilesStoreState {
  mainView: MainContentView
  projects: Record<string, ProjectFilesUiState>
  setMainView: (view: MainContentView) => void
  setEditingFile: (projectId: string, file: EditingFileState | null) => void
  toggleExpandedDir: (projectId: string, dirPath: string) => void
  setExpandedDirs: (projectId: string, dirs: Record<string, boolean>) => void
  setEditorWidth: (projectId: string, width: number) => void
  clearProject: (projectId: string) => void
}

function createDefaultProjectState(): ProjectFilesUiState {
  return {
    expandedDirs: {},
    editingFile: null,
    editorWidth: 560,
  }
}

const DEFAULT_PROJECT_FILES_STATE = createDefaultProjectState()

function getProjectState(projects: Record<string, ProjectFilesUiState>, projectId: string) {
  return projects[projectId] ?? createDefaultProjectState()
}

export const useFilesStore = create<FilesStoreState>()(
  persist(
    (set) => ({
      mainView: "chat",
      projects: {},
      setMainView: (view) => set({ mainView: view }),
      setEditingFile: (projectId, file) =>
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...getProjectState(state.projects, projectId),
              editingFile: file,
            },
          },
        })),
      toggleExpandedDir: (projectId, dirPath) =>
        set((state) => {
          const current = getProjectState(state.projects, projectId)
          const expanded = current.expandedDirs[dirPath] ?? false
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...current,
                expandedDirs: {
                  ...current.expandedDirs,
                  [dirPath]: !expanded,
                },
              },
            },
          }
        }),
      setExpandedDirs: (projectId, dirs) =>
        set((state) => {
          const current = getProjectState(state.projects, projectId)
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...current,
                expandedDirs: {
                  ...current.expandedDirs,
                  ...dirs,
                },
              },
            },
          }
        }),
      setEditorWidth: (projectId, width) =>
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...getProjectState(state.projects, projectId),
              editorWidth: Math.max(320, width),
            },
          },
        })),
      clearProject: (projectId) =>
        set((state) => {
          const { [projectId]: _removed, ...rest } = state.projects
          return { projects: rest }
        }),
    }),
    {
      name: "kanna-files-store",
      version: 1,
      partialize: (state) => ({
        mainView: state.mainView,
        projects: state.projects,
      }),
    },
  ),
)

export function useProjectFilesState(projectId: string | undefined) {
  return useFilesStore(useShallow((state) => {
    if (!projectId) {
      return DEFAULT_PROJECT_FILES_STATE
    }
    return state.projects[projectId] ?? DEFAULT_PROJECT_FILES_STATE
  }))
}

export function resetFilesViewForNewChat() {
  useFilesStore.getState().setMainView("chat")
}
