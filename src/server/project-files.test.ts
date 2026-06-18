import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  contentDispositionAttachment,
  getFileTree,
  handleProjectFilesRequest,
  resolvePathInProject,
  validateFilename,
} from "./project-files"
import { EventStore } from "./event-store"
import type { IUserScopedEventStore } from "./event-store-types"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTestProject() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-files-data-"))
  const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-files-project-"))
  tempDirs.push(dataDir, projectDir)

  await writeFile(path.join(projectDir, "hello.txt"), "hello")
  await mkdir(path.join(projectDir, "src"), { recursive: true })
  await writeFile(path.join(projectDir, "src", "main.ts"), "export {}")
  await mkdir(path.join(projectDir, "node_modules", "pkg"), { recursive: true })
  await writeFile(path.join(projectDir, "node_modules", "pkg", "index.js"), "")

  const store = new EventStore(dataDir)
  await store.initialize()
  const project = await store.openProject(projectDir)
  return { store: store as unknown as IUserScopedEventStore, project, projectDir }
}

describe("project-files", () => {
  test("resolvePathInProject rejects traversal", () => {
    const root = "/tmp/project"
    expect(resolvePathInProject(root, "../etc/passwd").ok).toBe(false)
    expect(resolvePathInProject(root, "src/main.ts").ok).toBe(true)
  })

  test("validateFilename rejects invalid names", () => {
    expect(validateFilename("").ok).toBe(false)
    expect(validateFilename("bad/name").ok).toBe(false)
    expect(validateFilename("good-name.ts").ok).toBe(true)
  })

  test("getFileTree skips ignored directories", async () => {
    const { projectDir } = await createTestProject()
    const tree = await getFileTree(projectDir, 3, 0)
    const names = tree.map((node) => node.name)
    expect(names).toContain("hello.txt")
    expect(names).toContain("src")
    expect(names).not.toContain("node_modules")
  })

  test("lists project files via HTTP handler", async () => {
    const { store, project } = await createTestProject()
    const response = await handleProjectFilesRequest(
      new Request(`http://localhost/api/projects/${project.id}/files`),
      new URL(`http://localhost/api/projects/${project.id}/files`),
      store,
    )
    expect(response?.status).toBe(200)
    const body = await response!.json() as Array<{ name: string }>
    expect(body.some((node) => node.name === "hello.txt")).toBe(true)
  })

  test("reads and writes text files", async () => {
    const { store, project, projectDir } = await createTestProject()
    const filePath = path.join(projectDir, "hello.txt")

    const readResponse = await handleProjectFilesRequest(
      new Request(`http://localhost/api/projects/${project.id}/file?path=${encodeURIComponent(filePath)}`),
      new URL(`http://localhost/api/projects/${project.id}/file?path=${encodeURIComponent(filePath)}`),
      store,
    )
    expect(readResponse?.status).toBe(200)
    const readBody = await readResponse!.json() as { content: string }
    expect(readBody.content).toBe("hello")

    const writeResponse = await handleProjectFilesRequest(
      new Request(`http://localhost/api/projects/${project.id}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content: "updated" }),
      }),
      new URL(`http://localhost/api/projects/${project.id}/file`),
      store,
    )
    expect(writeResponse?.status).toBe(200)
    expect(await Bun.file(filePath).text()).toBe("updated")
  })

  test("blocks writes under .kanna", async () => {
    const { store, project, projectDir } = await createTestProject()
    const kannaFile = path.join(projectDir, ".kanna", "secret.txt")
    await mkdir(path.dirname(kannaFile), { recursive: true })
    await writeFile(kannaFile, "secret")

    const writeResponse = await handleProjectFilesRequest(
      new Request(`http://localhost/api/projects/${project.id}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: kannaFile, content: "nope" }),
      }),
      new URL(`http://localhost/api/projects/${project.id}/file`),
      store,
    )
    expect(writeResponse?.status).toBe(403)
  })

  test("uploads files via multipart handler", async () => {
    const { store, project, projectDir } = await createTestProject()
    const formData = new FormData()
    formData.append("targetPath", "")
    formData.append("files", new File(["uploaded"], "upload.txt", { type: "text/plain" }))

    const response = await handleProjectFilesRequest(
      new Request(`http://localhost/api/projects/${project.id}/files/upload`, {
        method: "POST",
        body: formData,
      }),
      new URL(`http://localhost/api/projects/${project.id}/files/upload`),
      store,
    )
    expect(response?.status).toBe(200)
    const body = await response!.json() as { uploadedCount: number }
    expect(body.uploadedCount).toBe(1)
    expect(await Bun.file(path.join(projectDir, "upload.txt")).text()).toBe("uploaded")
  })

  test("downloads files with attachment disposition", async () => {
    const { store, project, projectDir } = await createTestProject()
    const filePath = path.join(projectDir, "hello.txt")

    const response = await handleProjectFilesRequest(
      new Request(`http://localhost/api/projects/${project.id}/files/download?path=${encodeURIComponent(filePath)}`),
      new URL(`http://localhost/api/projects/${project.id}/files/download?path=${encodeURIComponent(filePath)}`),
      store,
    )
    expect(response?.status).toBe(200)
    expect(response?.headers.get("Content-Disposition")).toBe(contentDispositionAttachment("hello.txt"))
    expect(await response!.text()).toBe("hello")
  })
})
