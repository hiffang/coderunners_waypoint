import { requireRole } from "@/server/auth/guards";
import { handle, ok, forbidden } from "@/server/http";
import { db } from "@/server/db";
import { issueInclude, toIssueDto } from "@/server/dto";
export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const actor = await requireRole("STORE");
  if (!actor.outletId) throw forbidden("Account has no outlet");
  const rows = await db.issue.findMany({
    where: { order: { outletId: actor.outletId } },
    include: issueInclude,
    orderBy: { createdAt: "desc" },
  });
  return ok(rows.map(toIssueDto));
});
