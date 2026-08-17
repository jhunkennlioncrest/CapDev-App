/**
 * Administration lands as Pass 2. This is deliberately a stub rather than a
 * hidden nav item: an administrator should be able to see where platform
 * management will live, and know it is coming rather than missing.
 */
export function AdminPlaceholder(): JSX.Element {
  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5">
        <h1 className="font-display text-3xl">Administration</h1>
        <p className="text-ink-70 text-[14px] mt-1 max-w-xl">
          Running the platform: people, roles, and the rubric.
        </p>
      </header>

      <div className="border border-dashed border-rule rounded bg-card px-8 py-12">
        <h2 className="font-display text-2xl mb-3">Arriving next</h2>
        <ul className="text-ink-70 text-[14px] space-y-1.5 max-w-md">
          <li>User management and invitations</li>
          <li>Role assignment &mdash; reviewer, trainer, administrator</li>
          <li>Rubric version management &mdash; draft, activate, archive</li>
          <li>Reviewer and trainer onboarding</li>
        </ul>
        <p className="text-[13px] text-ink-45 mt-5 max-w-md">
          Until this ships, roles and rubric versions are changed directly in the
          database. Everything else in the platform works without it.
        </p>
      </div>
    </div>
  );
}
