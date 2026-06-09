import { randomUUID } from "node:crypto"
import { access } from "node:fs/promises"
import { and, eq, isNull } from "drizzle-orm"
import type { AttachmentStorageBackend, ChatAttachment } from "../shared/types"
import { getDb, type KannaDatabase } from "./db/client"
import { attachmentObjects, projects } from "./db/schema"
import {
  isOwnedObjectKey,
  OBJECT_STORAGE_ATTACHMENT_PREFIX,
  ObjectStorageService,
  parseObjectKeyFromContentUrl,
} from "./object-storage"
import { deleteProjectUpload, inferAttachmentContentType, persistProjectUpload } from "./uploads"
import path from "node:path"

export const ATTACHMENT_CONTENT_PATH_PREFIX = "/api/attachments/"

export function attachmentContentUrl(attachmentId: string) {
  return `${ATTACHMENT_CONTENT_PATH_PREFIX}${encodeURIComponent(attachmentId)}/content`
}

async function fileExists(filePath: string): Promise<boolean> {
  if (!filePath) return false
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export class AttachmentService {
  constructor(
    private readonly objectStorage: ObjectStorageService,
    private readonly databaseUrl: string | null,
  ) {}

  private get db(): KannaDatabase | null {
    return this.databaseUrl ? getDb(this.databaseUrl) : null
  }

  async upload(args: {
    userId: string
    projectId: string
    localPath: string
    fileName: string
    bytes: Uint8Array
    mimeType?: string
  }): Promise<ChatAttachment> {
    if (this.objectStorage.enabled && this.db) {
      return this.uploadToObjectStorage(args)
    }
    return this.uploadLocalOnly(args)
  }

  private async uploadToObjectStorage(args: {
    userId: string
    projectId: string
    localPath: string
    fileName: string
    bytes: Uint8Array
    mimeType?: string
  }): Promise<ChatAttachment> {
    const attachmentId = randomUUID()
    const uploaded = await this.objectStorage.uploadAttachment({
      userId: args.userId,
      projectId: args.projectId,
      fileName: args.fileName,
      bytes: args.bytes,
      mimeType: args.mimeType,
    })

    let localCachePath: string | null = null
    let absolutePath = ""
    let relativePath = ""
    let kind: ChatAttachment["kind"] = args.mimeType?.startsWith("image/") ? "image" : "file"

    try {
      const cached = await persistProjectUpload({
        projectId: args.projectId,
        localPath: args.localPath,
        fileName: args.fileName,
        bytes: args.bytes,
        fallbackMimeType: args.mimeType,
      })
      localCachePath = cached.absolutePath
      absolutePath = cached.absolutePath
      relativePath = cached.relativePath
      kind = cached.kind
    } catch (error) {
      console.error("[attachments] Local cache write failed:", error)
    }

    await this.db!.insert(attachmentObjects).values({
      id: attachmentId,
      userId: args.userId,
      projectId: args.projectId,
      objectKey: uploaded.objectKey,
      fileName: args.fileName,
      mimeType: args.mimeType ?? null,
      sizeBytes: args.bytes.byteLength,
      storageBackend: "object_storage",
      localCachePath,
    })

    return {
      id: attachmentId,
      storageId: attachmentId,
      objectKey: uploaded.objectKey,
      storageBackend: "object_storage",
      kind,
      displayName: args.fileName,
      absolutePath,
      relativePath,
      contentUrl: attachmentContentUrl(attachmentId),
      mimeType: args.mimeType || "application/octet-stream",
      size: args.bytes.byteLength,
    }
  }

  private async uploadLocalOnly(args: {
    projectId: string
    localPath: string
    fileName: string
    bytes: Uint8Array
    mimeType?: string
  }): Promise<ChatAttachment> {
    const attachment = await persistProjectUpload({
      projectId: args.projectId,
      localPath: args.localPath,
      fileName: args.fileName,
      bytes: args.bytes,
      fallbackMimeType: args.mimeType,
    })
    return {
      ...attachment,
      storageBackend: "local",
    }
  }

  async readContent(args: {
    attachmentId: string
    userId: string
  }): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string | null }> {
    const record = await this.lookupRecord(args.attachmentId, args.userId)
    if (record) {
      if (record.storageBackend === "object_storage") {
        const stored = await this.objectStorage.getAttachment(record.objectKey)
        return {
          bytes: stored.bytes,
          fileName: record.fileName,
          mimeType: record.mimeType ?? stored.mimeType,
        }
      }

      if (record.localCachePath && await fileExists(record.localCachePath)) {
        const file = Bun.file(record.localCachePath)
        return {
          bytes: new Uint8Array(await file.arrayBuffer()),
          fileName: record.fileName,
          mimeType: record.mimeType,
        }
      }
    }

    throw new Error("Attachment not found")
  }

  async resolveAttachmentContent(attachment: ChatAttachment, userId: string) {
    const attachmentId = attachment.storageId ?? parseAttachmentIdFromContentUrl(attachment.contentUrl)
    if (attachmentId && this.db) {
      return this.readContent({ attachmentId, userId })
    }

    if (attachment.storageBackend === "local" || attachment.contentUrl.includes("/uploads/")) {
      if (await fileExists(attachment.absolutePath)) {
        const file = Bun.file(attachment.absolutePath)
        return {
          bytes: new Uint8Array(await file.arrayBuffer()),
          fileName: attachment.displayName,
          mimeType: attachment.mimeType,
        }
      }
    }

    const legacyObjectKey = attachment.objectKey
      ?? parseObjectKeyFromContentUrl(attachment.contentUrl)
      ?? (isOwnedObjectKey(attachment.absolutePath, userId) ? attachment.absolutePath : null)

    if (legacyObjectKey && this.objectStorage.enabled) {
      const stored = await this.objectStorage.getAttachment(legacyObjectKey)
      return {
        bytes: stored.bytes,
        fileName: attachment.displayName || stored.fileName,
        mimeType: attachment.mimeType ?? stored.mimeType,
      }
    }

    throw new Error("Attachment not found")
  }

  async materializeForAgent(args: {
    attachments: ChatAttachment[]
    projectId: string
    localPath: string
    userId: string
  }): Promise<ChatAttachment[]> {
    if (args.attachments.length === 0) {
      return []
    }

    return Promise.all(args.attachments.map((attachment) => this.materializeOneForAgent({
      attachment,
      projectId: args.projectId,
      localPath: args.localPath,
      userId: args.userId,
    })))
  }

  private async materializeOneForAgent(args: {
    attachment: ChatAttachment
    projectId: string
    localPath: string
    userId: string
  }): Promise<ChatAttachment> {
    const { attachment } = args

    if (await fileExists(attachment.absolutePath)) {
      return attachment
    }

    try {
      const content = await this.resolveAttachmentContent(attachment, args.userId)
      const materialized = await persistProjectUpload({
        projectId: args.projectId,
        localPath: args.localPath,
        fileName: attachment.displayName || content.fileName,
        bytes: content.bytes,
        fallbackMimeType: content.mimeType ?? attachment.mimeType,
      })

      const attachmentId = attachment.storageId ?? attachment.id
      if (this.db && attachment.storageBackend === "object_storage") {
        await this.db.update(attachmentObjects)
          .set({ localCachePath: materialized.absolutePath })
          .where(and(
            eq(attachmentObjects.id, attachmentId),
            eq(attachmentObjects.userId, args.userId),
            isNull(attachmentObjects.deletedAt),
          ))
      }

      return {
        ...materialized,
        id: attachment.id,
        storageId: attachment.storageId,
        objectKey: attachment.objectKey,
        storageBackend: attachment.storageBackend,
        displayName: attachment.displayName,
        contentUrl: attachment.contentUrl || attachmentContentUrl(attachmentId),
      }
    } catch (error) {
      console.error("[attachments] Failed to materialize attachment for agent:", error)
      return attachment
    }
  }

  async deleteAttachment(args: {
    attachmentId: string
    userId: string
    localPath?: string
  }): Promise<boolean> {
    const record = await this.lookupRecord(args.attachmentId, args.userId)
    if (!record) {
      return false
    }

    await this.db!.update(attachmentObjects)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(attachmentObjects.id, args.attachmentId),
        eq(attachmentObjects.userId, args.userId),
      ))

    if (record.localCachePath) {
      const projectRows = await this.db!.select({ localPath: projects.localPath })
        .from(projects)
        .where(and(
          eq(projects.id, record.projectId),
          eq(projects.userId, args.userId),
        ))
        .limit(1)

      const localPath = args.localPath ?? projectRows[0]?.localPath
      if (localPath) {
        await deleteProjectUpload({
          localPath,
          storedName: path.basename(record.localCachePath),
        }).catch(() => false)
      }
    }

    return true
  }

  private async lookupRecord(attachmentId: string, userId: string) {
    if (!this.db) {
      return null
    }

    const rows = await this.db.select()
      .from(attachmentObjects)
      .where(and(
        eq(attachmentObjects.id, attachmentId),
        eq(attachmentObjects.userId, userId),
        isNull(attachmentObjects.deletedAt),
      ))
      .limit(1)

    return rows[0] ?? null
  }
}

export function parseAttachmentIdFromContentUrl(contentUrl: string): string | null {
  if (!contentUrl.startsWith(ATTACHMENT_CONTENT_PATH_PREFIX)) {
    return null
  }

  const remainder = contentUrl.slice(ATTACHMENT_CONTENT_PATH_PREFIX.length)
  const slashIndex = remainder.indexOf("/")
  const encodedId = slashIndex === -1 ? remainder : remainder.slice(0, slashIndex)
  if (!encodedId) {
    return null
  }

  return decodeURIComponent(encodedId)
}

export function inferAttachmentResponseContentType(fileName: string, mimeType?: string | null) {
  return inferAttachmentContentType(fileName, mimeType ?? undefined)
}

export { parseObjectKeyFromContentUrl, OBJECT_STORAGE_ATTACHMENT_PREFIX }
