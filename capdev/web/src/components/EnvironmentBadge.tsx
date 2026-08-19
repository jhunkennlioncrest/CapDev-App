import {
  DECLARED_ENVIRONMENT,
  ENVIRONMENT_COLOUR,
  ENVIRONMENT_LABEL,
} from "@/lib/environment";

/**
 * Always visible. Someone who cannot tell which environment they are in will
 * eventually do real work in the wrong one.
 */
export function EnvironmentBadge(): JSX.Element {
  const colour = ENVIRONMENT_COLOUR[DECLARED_ENVIRONMENT];
  return (
    <span
      className="text-[11px] border rounded-full px-2.5 py-0.5 whitespace-nowrap"
      style={{ color: colour, borderColor: colour }}
      title={
        DECLARED_ENVIRONMENT === "sandbox"
          ? "Experimentation. Nothing here is an official record."
          : "Live operational work. Everything here is official."
      }
    >
      {ENVIRONMENT_LABEL[DECLARED_ENVIRONMENT]}
    </span>
  );
}

/** Blocks the application when the deployment and database disagree. */
export function EnvironmentMismatch({
  declared,
  actual,
}: {
  declared: string;
  actual: string;
}): JSX.Element {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="max-w-lg border border-[#AC3A2A] rounded bg-card px-7 py-6">
        <h1 className="font-display text-2xl mb-2">Wrong database</h1>
        <p className="text-[14px] text-ink-70">
          This deployment is configured as{" "}
          <span className="font-semibold">{declared}</span>, but it is connected
          to a <span className="font-semibold">{actual}</span> database.
        </p>
        <p className="text-[13.5px] text-ink-70 mt-3">
          The application has stopped rather than let anyone work in the wrong
          environment. Check the Supabase URL in this deployment&rsquo;s settings.
        </p>
      </div>
    </main>
  );
}
