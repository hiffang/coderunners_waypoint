import type { PlanDto } from "@/shared/dto/plan";
import type { OrderDto } from "@/shared/dto/order";
import type { ManifestDto } from "@/shared/dto/manifest";
import type { IssueDto } from "@/shared/dto/issue";
import type { PlanningOrder } from "./server/planning/engine";
export type PlanDetail = PlanDto & {
  orders: PlanningOrder[];
  manifests: ManifestDto[];
};
export type Monitor = {
  serverTime: string;
  trips: ManifestDto[];
  orders: OrderDto[];
  issues: IssueDto[];
};
