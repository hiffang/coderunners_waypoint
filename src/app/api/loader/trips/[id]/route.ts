import { handle, ok } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { loadLoaderTrip, toLoaderManifestDto } from "@/features/loader/server/manifest";

export const dynamic = "force-dynamic";

/** Versioned manifest: delivery sequence, reverse loading sequence, lines, checks and issues. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/loader/trips/[id]">) => {
  const user = await requireRole("LOADER");
  const { id } = await ctx.params;
  const trip = await loadLoaderTrip(db, user, id);
  return ok(toLoaderManifestDto(trip));
});
