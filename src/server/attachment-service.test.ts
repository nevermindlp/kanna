import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ChatAttachment } from "../shared/types"
import {
  attachmentContentUrl,
  AttachmentService,
  parseAttachmentIdFromContentUrl,
} from "./attachment-service"
import {
  isOwnedObjectKey,
  OBJECT_STORAGE_ATTACHMENT_PREFIX,
  parseObjectKeyFromContentUrl,
} from "./object-storage"
import { persistProjectUpload } from "./uploads"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("attachment service helpers", () => {
  test("builds stable attachment content URLs by id", () => {
    expect(attachmentContentUrl("attachment-1")).toBe("/api/attachments/attachment-1/content")
    expect(parseAttachmentIdFromContentUrl("/api/attachments/attachment-1/content")).toBe("attachment-1")
  })

  test("parses legacy object keys from attachment content URLs", () => {
    const objectKey = "user-1/project-1/uuid-notes.txt"
    const contentUrl = `${OBJECT_STORAGE_ATTACHMENT_PREFIX}${encodeURIComponent(objectKey)}`
    expect(parseObjectKeyFromContentUrl(contentUrl)).toBe(objectKey)
    expect(parseObjectKeyFromContentUrl("/api/projects/p/uploads/notes.txt/content")).toBeNull()
  })

  test("checks object key ownership by user id prefix", () => {
    expect(isOwnedObjectKey("user-1/project-1/file.txt", "user-1")).toBe(true)
    expect(isOwnedObjectKey("user-2/project-1/file.txt", "user-1")).toBe(false)
  })
})

describe("AttachmentService.materializeForAgent", () => {
  test("returns attachments unchanged when local files already exist", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-materialize-local-"))
    tempDirs.push(projectDir)

    const attachment = await persistProjectUpload({
      projectId: "project-1",
      localPath: projectDir,
      fileName: "notes.txt",
      bytes: new TextEncoder().encode("hello"),
      fallbackMimeType: "text/plain",
    })

    const service = new AttachmentService({ enabled: false } as any, null)
    const resolved = await service.materializeForAgent({
      attachments: [attachment],
      projectId: "project-1",
      localPath: projectDir,
      userId: "user-1",
    })

    expect(resolved).toEqual([attachment])
  })

  test("materializes object-storage attachments onto disk for the agent", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-materialize-s3-"))
    tempDirs.push(projectDir)

    const attachment: ChatAttachment = {
      id: "attachment-1",
      storageId: "attachment-1",
      storageBackend: "object_storage",
      objectKey: "user-1/project-1/uuid-notes.txt",
      kind: "file",
      displayName: "notes.txt",
      absolutePath: "",
      relativePath: "",
      contentUrl: attachmentContentUrl("attachment-1"),
      mimeType: "text/plain",
      size: 5,
    }

    const objectStorage = {
      enabled: true,
      parseObjectKeyFromContentUrl,
      isOwnedObjectKey,
      getAttachment: async () => ({
        bytes: new TextEncoder().encode("hello"),
        mimeType: "text/plain",
        fileName: "uuid-notes.txt",
      }),
    }

    const service = new AttachmentService(objectStorage as any, null)
    const resolved = await service.materializeForAgent({
      attachments: [attachment],
      projectId: "project-1",
      localPath: projectDir,
      userId: "user-1",
    })

    expect(resolved[0]?.id).toBe("attachment-1")
    expect(resolved[0]?.displayName).toBe("notes.txt")
    expect(resolved[0]?.absolutePath).toBe(path.join(projectDir, ".kanna/uploads/notes.txt"))
    expect(resolved[0]?.relativePath).toBe("./.kanna/uploads/notes.txt")
    expect(await Bun.file(resolved[0]!.absolutePath).text()).toBe("hello")
  })
})
