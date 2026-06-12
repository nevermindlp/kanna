import { readFileSync } from "node:fs"
import path from "node:path"
import { resolveKannaRuntimeConfig } from "../src/server/kanna-config"
import { ObjectStorageService } from "../src/server/object-storage"

function loadEnvFile(filePath: string) {
  const content = readFileSync(filePath, "utf8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

const envPath = path.join(import.meta.dir, "..", ".env.local")
loadEnvFile(envPath)

const config = resolveKannaRuntimeConfig(process.env)
const storage = new ObjectStorageService(config)

if (!storage.enabled) {
  console.error("Object storage is not configured. Check .env.local")
  process.exit(1)
}

console.log("OBS config:")
console.log(`  endpoint: ${config.s3.endpoint}`)
console.log(`  region:   ${config.s3.region}`)
console.log(`  bucket:   ${config.s3.bucket}`)
console.log(`  prefix:   ${config.s3.keyPrefix ?? "(none)"}`)

console.log("\n1/3 HeadBucket connectivity check...")
await storage.verifyConnection()
console.log("OK")

console.log("\n2/3 Upload test object...")
const uploaded = await storage.uploadAttachment({
  userId: "kanna-test-user",
  projectId: "kanna-test-project",
  fileName: "obs-smoke-test.txt",
  bytes: new TextEncoder().encode(`kanna obs smoke test ${new Date().toISOString()}`),
  mimeType: "text/plain",
})
console.log(`OK  objectKey=${uploaded.objectKey}`)

console.log("\n3/3 Read back test object...")
const stored = await storage.getAttachment(uploaded.objectKey)
const text = new TextDecoder().decode(stored.bytes)
console.log(`OK  bytes=${stored.bytes.length} content=${text.slice(0, 60)}...`)

console.log("\n4/4 Ownership check...")
if (!storage.isOwnedObjectKey(uploaded.objectKey, "kanna-test-user")) {
  throw new Error("Ownership check failed")
}
console.log("OK")

console.log("\nAll OBS tests passed.")
