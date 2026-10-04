/** Visible placeholder for a screen that is not implemented yet. Never fake data here. */
export function NotBuilt({ portal, owner }: { portal: string; owner: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-dashed bg-card p-8 text-center">
      <p className="text-sm font-semibold text-late">Not built yet</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{portal} portal</h1>
      <p className="mt-2 text-sm text-muted-foreground">Signed in and authorized. Implementation: {owner}.</p>
    </div>
  );
}
