"use client";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiFetch, ApiClientError, type Page } from "@/shared/api";
import type { OrderDto } from "@/shared/dto/order";
import type { ReferenceDto } from "@/shared/dto/reference";
import type { MeDto } from "@/shared/dto/me";
import type { IssueDto } from "@/shared/dto/issue";
import type { StoreOrderDetail } from "./types";

export const storeKeys = ["store"] as const;
export function useStoreOrders() {
  return useInfiniteQuery({
    queryKey: [...storeKeys, "orders"],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      apiFetch<Page<OrderDto>>(
        `/api/store/orders?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 15000,
  });
}
export function useStoreOrder(id: string) {
  return useQuery({
    queryKey: [...storeKeys, "order", id],
    queryFn: () => apiFetch<StoreOrderDetail>(`/api/store/orders/${id}`),
    refetchInterval: 10000,
  });
}
export function useStoreReference() {
  return useQuery({
    queryKey: [...storeKeys, "reference"],
    queryFn: () => apiFetch<ReferenceDto>("/api/shared/reference"),
    refetchInterval: 30000,
  });
}
export function useStoreMe() {
  return useQuery({
    queryKey: [...storeKeys, "me"],
    queryFn: () => apiFetch<MeDto>("/api/shared/me"),
    refetchInterval: 30000,
  });
}
export function useStoreIssues() {
  return useQuery({
    queryKey: [...storeKeys, "issues"],
    queryFn: () => apiFetch<IssueDto[]>("/api/store/issues"),
    refetchInterval: 15000,
  });
}

/** Keep the same key AND payload after an ambiguous failure. Edits create a new action. */
export function useStoreCommand<T>() {
  const client = useQueryClient();
  const pending = useRef<{
    signature: string;
    key: string;
    payload: string;
  } | null>(null);
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function execute(
    path: string,
    body: unknown,
    method = "POST",
  ): Promise<T | undefined> {
    if (busy.current) return;
    const payload = JSON.stringify(body);
    const intent =
      typeof body === "object" && body !== null
        ? { ...body, expectedVersion: undefined }
        : body;
    const signature = `${method}:${path}:${JSON.stringify(intent)}`;
    if (pending.current?.signature !== signature)
      pending.current = { signature, key: crypto.randomUUID(), payload };
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await apiFetch<T>(path, {
        method,
        body: pending.current.payload,
        idempotencyKey: pending.current.key,
      });
      pending.current = null;
      await client.invalidateQueries({ queryKey: storeKeys });
      return result;
    } catch (error) {
      if (error instanceof ApiClientError && error.status < 500)
        pending.current = null;
      setError(
        error instanceof Error
          ? error.message
          : "Unable to reach the server. Your submission is not confirmed. Retry when connected.",
      );
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { execute, isPending, error };
}
