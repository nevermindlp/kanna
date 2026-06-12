import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { randomUUID } from "node:crypto"
import { resolveS3ForcePathStyle, type KannaRuntimeConfig } from "./kanna-config"
import type { ChatAttachment } from "../shared/types"

const DEFAULT_BINARY_MIME_TYPE = "application/octet-stream"
const IMAGE_MIME_PREFIX = "image/"

export const OBJECT_STORAGE_ATTACHMENT_PREFIX = "/api/attachments/"

export function parseObjectKeyFromContentUrl(contentUrl: string): string | null {
  if (!contentUrl.startsWith(OBJECT_STORAGE_ATTACHMENT_PREFIX)) {
    return null
  }

  const encoded = contentUrl.slice(OBJECT_STORAGE_ATTACHMENT_PREFIX.length)
  if (!encoded) {
    return null
  }

  return decodeURIComponent(encoded)
}

export function isOwnedObjectKey(objectKey: string, userId: string): boolean {
  return objectKey.startsWith(`${userId}/`)
}

export class ObjectStorageService {
  private readonly client: S3Client | null
  private readonly bucket: string | null

  constructor(config: KannaRuntimeConfig) {
    if (!config.s3.bucket || !config.s3.accessKeyId || !config.s3.secretAccessKey) {
      this.client = null
      this.bucket = null
      return
    }

    this.bucket = config.s3.bucket
    this.client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint ?? undefined,
      forcePathStyle: resolveS3ForcePathStyle(config.s3),
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    })
  }

  async verifyConnection(): Promise<void> {
    if (!this.client || !this.bucket) {
      return
    }

    await this.client.send(new HeadBucketCommand({
      Bucket: this.bucket,
    }))
  }

  get enabled() {
    return Boolean(this.client && this.bucket)
  }

  parseObjectKeyFromContentUrl(contentUrl: string) {
    return parseObjectKeyFromContentUrl(contentUrl)
  }

  isOwnedObjectKey(objectKey: string, userId: string) {
    return isOwnedObjectKey(objectKey, userId)
  }

  async uploadAttachment(args: {
    userId: string
    projectId: string
    fileName: string
    bytes: Uint8Array
    mimeType?: string
  }): Promise<{ objectKey: string; contentUrl: string }> {
    if (!this.client || !this.bucket) {
      throw new Error("Object storage is not configured")
    }

    const objectKey = `${args.userId}/${args.projectId}/${randomUUID()}-${args.fileName}`
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: args.bytes,
      ContentType: args.mimeType,
    }))

    return {
      objectKey,
      contentUrl: `${OBJECT_STORAGE_ATTACHMENT_PREFIX}${encodeURIComponent(objectKey)}`,
    }
  }

  async getAttachment(objectKey: string): Promise<{ bytes: Uint8Array; mimeType: string | null; fileName: string }> {
    if (!this.client || !this.bucket) {
      throw new Error("Object storage is not configured")
    }

    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    }))

    if (!response.Body) {
      throw new Error("Attachment body is empty")
    }

    const bytes = new Uint8Array(await response.Body.transformToByteArray())
    const fileName = objectKey.slice(objectKey.lastIndexOf("/") + 1)
    return {
      bytes,
      mimeType: response.ContentType ?? null,
      fileName,
    }
  }

  toChatAttachment(args: {
    objectKey: string
    contentUrl: string
    fileName: string
    mimeType?: string
    absolutePath?: string
    relativePath?: string
    size?: number
  }): ChatAttachment {
    const mimeType = args.mimeType || DEFAULT_BINARY_MIME_TYPE
    return {
      id: randomUUID(),
      kind: mimeType.startsWith(IMAGE_MIME_PREFIX) ? "image" : "file",
      displayName: args.fileName,
      absolutePath: args.absolutePath ?? args.objectKey,
      relativePath: args.relativePath ?? args.objectKey,
      contentUrl: args.contentUrl,
      mimeType,
      size: args.size ?? 0,
    }
  }
}
