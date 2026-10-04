import { handle, notFound } from "@/server/http";
import { requireRole, type SessionUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { readUpload } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Streams a private attachment after checking the caller may see what it is linked to. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/shared/files/[id]">) => {
  const user = await requireRole();
  const { id } = await ctx.params;
  const a = await db.attachment.findUnique({
    where: { id },
    include: {
      proof: { include: { stop: { include: { trip: true } } } },
      issue: { include: { trip: true, order: true, stop: { include: { trip: true } } } },
      receipt: { include: { order: true } },
    },
  });
  // 404 (not 403) for anything not visible, so ids cannot be probed.
  if (!a || !canView(user, a)) throw notFound("Attachment not found");

  const bytes = await readUpload(a.storageKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": a.contentType,
      "content-length": String(bytes.length),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
});

type Trip = { depotId: string; assignedDriverId: string | null };
type Order = { outletId: string; depotId: string };

function canView(
  user: SessionUser,
  a: {
    uploadedById: string;
    proof: { stop: { outletId: string; trip: Trip } } | null;
    issue: { trip: Trip | null; order: Order | null; stop: { trip: Trip } | null } | null;
    receipt: { order: Order } | null;
  },
) {
  if (a.uploadedById === user.id) return true;
  const trips: Trip[] = [];
  const orders: Order[] = [];
  const outlets: string[] = [];
  if (a.proof) {
    trips.push(a.proof.stop.trip);
    outlets.push(a.proof.stop.outletId);
  }
  if (a.issue) {
    if (a.issue.trip) trips.push(a.issue.trip);
    if (a.issue.stop) trips.push(a.issue.stop.trip);
    if (a.issue.order) orders.push(a.issue.order);
  }
  if (a.receipt) orders.push(a.receipt.order);

  switch (user.role) {
    case "DISPATCHER":
    case "LOADER":
      return trips.some((t) => t.depotId === user.depotId) || orders.some((o) => o.depotId === user.depotId);
    case "DRIVER":
      return trips.some((t) => t.assignedDriverId === user.id);
    case "STORE":
      return outlets.includes(user.outletId ?? "") || orders.some((o) => o.outletId === user.outletId);
  }
}
