import type { OrderDto } from "@/shared/dto/order";
import type { IssueDto } from "@/shared/dto/issue";
export type StoreOrderDetail = {
  order: OrderDto;
  editable: boolean;
  issues: IssueDto[];
  serverTime: string;
};
