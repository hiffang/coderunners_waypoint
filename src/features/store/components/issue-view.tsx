"use client";
import Link from "next/link";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { storeIssueSchema, type IssueDto } from "@/shared/dto/issue";
import { ISSUE_TYPES, ISSUE_SEVERITIES } from "@/shared/dto/enums";
import { useStoreCommand, useStoreIssues, useStoreOrder } from "../hooks";
import {
  Back,
  Empty,
  Failure,
  Heading,
  instant,
  label,
  Loading,
  Notice,
  Panel,
  Refresh,
  Status,
} from "./bits";
export function IssueHistory({ issues }: { issues: IssueDto[] }) {
  return issues.length ? (
    <div className="space-y-3">
      {issues.map((i) => (
        <article key={i.id} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {label(i.type)} · {label(i.severity)} severity
            </p>
            <Status value={i.status} />
          </div>
          {i.orderId && (
            <Link
              href={`/store/orders/${i.orderId}`}
              className="font-id mt-2 inline-block text-xs underline"
            >
              {i.orderRef}
            </Link>
          )}
          <p className="my-3 whitespace-pre-wrap text-sm">{i.text}</p>
          <p className="text-xs text-muted-foreground">
            Reported by {i.reporter.name} · {instant(i.createdAt)}
          </p>
          {i.acknowledgedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Acknowledged {instant(i.acknowledgedAt)}
            </p>
          )}
          {i.resolution && (
            <div className="mt-3 rounded-lg bg-lime-soft p-3 text-sm">
              <strong>Dispatcher response</strong>
              <p className="whitespace-pre-wrap">{i.resolution}</p>
              {i.resolvedAt && (
                <p className="mt-1 text-xs">
                  Resolved {instant(i.resolvedAt)} by {i.resolvedBy?.name}
                </p>
              )}
            </div>
          )}
          {i.attachments.map((f, n) => (
            <a
              className="mr-3 text-xs underline"
              key={f.id}
              href={f.url}
              target="_blank"
              rel="noreferrer"
            >
              Evidence {n + 1}
            </a>
          ))}
        </article>
      ))}
    </div>
  ) : (
    <Empty>No issues reported.</Empty>
  );
}
export function IssuesPage() {
  const query = useStoreIssues();
  if (query.isPending) return <Loading />;
  if (query.error)
    return <Failure error={query.error} retry={() => query.refetch()} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Heading
        title="Issues"
        description="Discrepancies, delivery concerns, and dispatcher responses for your outlet."
      />
      <Refresh
        at={query.dataUpdatedAt}
        refresh={() => query.refetch()}
        busy={query.isFetching}
      />
      <Panel>
        <IssueHistory issues={query.data} />
      </Panel>
    </div>
  );
}
export function OrderIssues({ id }: { id: string }) {
  const query = useStoreOrder(id);
  const command = useStoreCommand<IssueDto>();
  const form = useForm<
    z.input<typeof storeIssueSchema>,
    unknown,
    z.output<typeof storeIssueSchema>
  >({
    resolver: zodResolver(storeIssueSchema),
    defaultValues: {
      expectedVersion: 1,
      type: "OTHER",
      severity: "MEDIUM",
      text: "",
      attachmentIds: [],
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error && !query.data)
    return <Failure error={query.error} retry={() => query.refetch()} />;
  if (!query.data) return null;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Back id={id} />
      <Heading
        title="Report an issue"
        description={`${query.data.order.orderRef} · ${query.data.order.outletLabel}`}
      />
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async (values) => {
          const result = await command.execute(
            `/api/store/orders/${id}/issues`,
            { ...values, expectedVersion: query.data.order.version },
          );
          if (result) {
            toast.success("Issue reported");
            form.reset({
              expectedVersion: 1,
              type: "OTHER",
              severity: "MEDIUM",
              text: "",
              attachmentIds: [],
            });
          }
        })}
      >
        <Panel>
          <fieldset disabled={command.isPending} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="issue-type">Issue type</Label>
                <select
                  id="issue-type"
                  {...form.register("type")}
                  className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                >
                  {ISSUE_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="severity">Severity</Label>
                <select
                  id="severity"
                  {...form.register("severity")}
                  className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                >
                  {ISSUE_SEVERITIES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <Label htmlFor="issue-text">What happened?</Label>
            <Textarea
              id="issue-text"
              {...form.register("text")}
              placeholder="Describe the discrepancy and affected goods…"
              aria-invalid={Boolean(form.formState.errors.text)}
            />
            <p className="text-sm text-late">
              {form.formState.errors.text?.message}
            </p>
          </fieldset>
        </Panel>
        {command.error && (
          <div role="alert">
            <Notice>
              {command.error} Your issue has not been confirmed. Retry when
              connected.
            </Notice>
          </div>
        )}
        <Button
          type="submit"
          className="bg-lime text-ink hover:bg-lime/80"
          disabled={command.isPending}
        >
          {command.isPending ? "Reporting…" : "Submit issue"}
        </Button>
      </form>
      <Panel>
        <h2 className="font-semibold">Issue history</h2>
        <IssueHistory issues={query.data.issues} />
      </Panel>
    </div>
  );
}
