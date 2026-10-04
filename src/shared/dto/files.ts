import type { IsoInstant } from "./common";

/** Accepted evidence types and size (POST /api/shared/files). */
export const UPLOAD_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Multipart form for POST /api/shared/files:
 *   file: Blob (jpeg/png/webp, <= 5 MB)
 *   clientFileId: client-generated UUID, stable across retries (idempotent)
 * Result: AttachmentDto. Uploading never links the file; the business
 * mutation (proof, issue, receipt) links it by attachment id.
 */
export type AttachmentDto = {
  id: string;
  clientFileId: string;
  contentType: string;
  size: number;
  url: string; // /api/shared/files/{id}, scope-checked; no public path
  createdAt: IsoInstant;
  linked: boolean;
};
