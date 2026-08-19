import { supabase } from "./supabase";

export type Environment = "sandbox" | "production";

/**
 * What this deployment believes it is. Set per Vercel deployment, not per user.
 * Defaults to sandbox: an unconfigured deployment must never present itself as
 * production, because the failure is silent in that direction.
 */
export const DECLARED_ENVIRONMENT: Environment =
  (import.meta.env.VITE_ENVIRONMENT as Environment) === "production"
    ? "production"
    : "sandbox";

export interface EnvironmentCheck {
  ok: boolean;
  declared: Environment;
  actual: Environment | null;
  message?: string;
}

/**
 * Verifies the app is connected to the database it expects.
 *
 * This is the entire point of storing environment at all. A sandbox deployment
 * pointed at the production database would let someone evaluate real calls in
 * what they believe is a scratch environment — and the mistake would only
 * surface much later. Failing at startup costs a moment; not failing costs the
 * integrity of the record.
 */
export async function verifyEnvironment(): Promise<EnvironmentCheck> {
  const { data, error } = await supabase.rpc("get_environment");

  if (error) {
    // Older databases predate this migration. Treat as unknown rather than
    // blocking — but say so, so it gets fixed.
    return {
      ok: true,
      declared: DECLARED_ENVIRONMENT,
      actual: null,
      message: "This database has not declared its environment.",
    };
  }

  const actual = data as Environment | null;
  if (!actual) {
    return { ok: true, declared: DECLARED_ENVIRONMENT, actual: null };
  }

  if (actual !== DECLARED_ENVIRONMENT) {
    return {
      ok: false,
      declared: DECLARED_ENVIRONMENT,
      actual,
      message:
        `This deployment is configured as ${DECLARED_ENVIRONMENT}, but the ` +
        `database it is connected to is ${actual}.`,
    };
  }

  return { ok: true, declared: DECLARED_ENVIRONMENT, actual };
}

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  sandbox: "Sandbox",
  production: "Production",
};

export const ENVIRONMENT_COLOUR: Record<Environment, string> = {
  sandbox: "#96690A",
  production: "#1F7A4D",
};
