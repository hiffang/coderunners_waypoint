import { forbidden, handle, ok } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { addDays, localDate, now } from "@/server/time";
import { issueInclude, toIssueDto } from "@/server/dto";
import type { LoaderIssueListDto } from "@/features/loader/types";

export const dynamic = "force-dynamic";

/** Issues on this depot's published trips: every unresolved one plus the last 7 days of history. */
export const GET = handle(async () => {
  const user = await requireRole("LOADER");
  if (!user.depotId) throw forbidden("Account has no depot");
  const since = addDays(localDate(now()), -7);

  const issues = await db.issue.findMany({
    where: {
      trip: { depotId: user.depotId, plan: { status: { in: ["PUBLISHED", "COMPLETED"] } } },
      OR: [{ status: { not: "RESOLVED" } }, { trip: { serviceDate: { gte: since } } }],
    },
    include: {
      ...issueInclude,
      trip: { select: { id: true, vehicleId: true, tripNumber: true, serviceDate: true, state: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const body: LoaderIssueListDto = {
    items: issues.filter((i) => i.trip).map((i) => ({ ...toIssueDto(i), trip: i.trip! })),
    serverTime: now().toISOString(),
  };
  return ok(body);
});
