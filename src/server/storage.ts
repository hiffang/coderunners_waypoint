import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { constraintError, badRequest, notFound } from "@/server/http";
import { MAX_UPLOAD_BYTES } from "@/shared/dto/files";

/**
 * Private evidence storage (delivery photos, discrepancy photos).
 * Files live in PRIVATE_UPLOAD_DIR (a Docker volume), never under public/.
 * They are served only through authorized API routes that check scope first.
 */
const ROOT = path.resolve(process.env.PRIVATE_UPLOAD_DIR ?? "./.data/uploads");

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type StoredFile = { storageKey: string; contentType: string; size: number };

export async function saveUpload(file: File, folder: string): Promise<StoredFile> {
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw constraintError("Only JPEG, PNG or WebP images are accepted");
  if (file.size > MAX_UPLOAD_BYTES) throw constraintError("File too large (max 5 MB)");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesMagic(bytes, file.type)) throw constraintError("File content does not match its type");

  const safeFolder = folder.replace(/[^a-z0-9-]/gi, "");
  const storageKey = `${safeFolder}/${randomUUID()}.${ext}`;
  const target = resolveKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  return { storageKey, contentType: file.type, size: bytes.length };
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  const target = resolveKey(storageKey);
  try {
    await stat(target);
  } catch {
    throw notFound("Attachment not found");
  }
  return readFile(target);
}

function resolveKey(storageKey: string) {
  const target = path.resolve(ROOT, storageKey);
  if (!target.startsWith(ROOT + path.sep)) throw badRequest("Invalid storage key");
  return target;
}

function matchesMagic(b: Buffer, type: string) {
  if (type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/png") return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
  return false;
}
