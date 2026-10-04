"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { apiFetch, type Page } from "@/shared/api";
import type { PlanSummaryDto } from "@/shared/dto/plan";
import type { ReferenceDto } from "@/shared/dto/reference";
import type { MeDto } from "@/shared/dto/me";
import type { Monitor, PlanDetail } from "./types";
export function useDispatcher(date: string) {
  const monitor = useQuery({
    queryKey: ["dispatcher", "monitor", date],
    queryFn: () =>
      apiFetch<Monitor>(`/api/dispatcher/monitor?serviceDate=${date}`),
    refetchInterval: 10000,
  });
  const plans = useQuery({
    queryKey: ["dispatcher", "plans", date],
    queryFn: () =>
      apiFetch<Page<PlanSummaryDto>>(
        `/api/dispatcher/plans?serviceDate=${date}`,
      ),
    refetchInterval: 10000,
  });
  const reference = useQuery({
    queryKey: ["dispatcher", "reference"],
    queryFn: () => apiFetch<ReferenceDto>("/api/shared/reference"),
  });
  const me = useQuery({
    queryKey: ["dispatcher", "me"],
    queryFn: () => apiFetch<MeDto>("/api/shared/me"),
  });
  return { monitor, plans, reference, me };
}
export function usePlan(id: string) {
  return useQuery({
    queryKey: ["dispatcher", "plan", id],
    queryFn: () => apiFetch<PlanDetail>(`/api/dispatcher/plans/${id}`),
    refetchInterval: 10000,
  });
}
export function useDispatcherMutation<T = unknown>() {
  const cache = useQueryClient();
  const pendingKeys = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
      key,
    }: {
      path: string;
      body: unknown;
      method?: string;
      key?: string;
    }) => {
      const signature = JSON.stringify({ path, method, body });
      const idempotencyKey =
        key ?? pendingKeys.current.get(signature) ?? crypto.randomUUID();
      pendingKeys.current.set(signature, idempotencyKey);
      return apiFetch<T>(`/api/dispatcher/${path}`, {
        method,
        body: JSON.stringify(body),
        idempotencyKey,
      });
    },
    onSuccess: async (_data, variables) => {
      pendingKeys.current.delete(
        JSON.stringify({
          path: variables.path,
          method: variables.method ?? "POST",
          body: variables.body,
        }),
      );
      await cache.invalidateQueries({ queryKey: ["dispatcher"] });
    },
    onError: (e) => toast.error(e.message),
  });
}
