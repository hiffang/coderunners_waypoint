import { Prisma } from "@/generated/prisma/client";
import { assertSameOrigin, constraintError, handle, ok, validationError } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { toAttachmentDto } from "@/server/dto";
import { saveUpload } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Provisional evidence upload (multipart: file, clientFileId). Idempotent per
 * (uploader, clientFileId): a retry returns the same attachment. The file is
 * linked later by the business mutation that references its id.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireRole();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw validationError("Expected multipart/form-data", { _: ["Invalid form body"] });
  }
  const clientFileId = form.get("clientFileId");
  const file = form.get("file");
  if (typeof clientFileId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(clientFileId)) {
    throw validationError("Invalid clientFileId", { clientFileId: ["8-64 chars, letters/digits/dashes"] });
  }
  if (!(file instanceof File)) throw validationError("Missing file", { file: ["Required"] });

  const existing = await db.attachment.findUnique({
    where: { uploadedById_clientFileId: { uploadedById: user.id, clientFileId } },
  });
  if (existing) return ok(toAttachmentDto(existing));

  const stored = await saveUpload(file, user.id);
  try {
    const row = await db.attachment.create({
      data: { uploadedById: user.id, clientFileId, contentType: stored.contentType, size: stored.size, storageKey: stored.storageKey },
    });
    return ok(toAttachmentDto(row));
  } catch (err) {
    // A concurrent retry won; return its row (this copy stays an unreferenced orphan file).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await db.attachment.findUnique({
        where: { uploadedById_clientFileId: { uploadedById: user.id, clientFileId } },
      });
      if (row) return ok(toAttachmentDto(row));
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) throw constraintError("Upload could not be recorded");
    throw err;
  }
});
