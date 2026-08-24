/**
 * Captures invite and recovery links before the Supabase client erases them.
 *
 * The Supabase client is created with detectSessionInUrl, so at module load it
 * parses the hash, stores the session, and strips the hash from the URL. By the
 * time any component renders there is nothing left to read — which is why the
 * previous check inside SignIn never fired.
 *
 * This module therefore runs FIRST, imported at the top of main.tsx before
 * anything that pulls in the Supabase client. ES imports are hoisted and
 * evaluated in order, so this is the only reliable place to win that race.
 *
 * The distinction it preserves is the one the routing was missing: holding a
 * session is not the same as having finished setting up an account.
 */

export type SetupKind = "invite" | "recovery";

const STORAGE_KEY = "capdev.account-setup";

function readFromHash(): SetupKind | null {
  const hash = window.location.hash;
  if (!hash) return null;
  // Supabase sends type=invite for an invitation, type=signup for an email
  // confirmation that also needs a password, and type=recovery for a reset.
  if (hash.includes("type=invite") || hash.includes("type=signup")) return "invite";
  if (hash.includes("type=recovery")) return "recovery";
  return null;
}

/**
 * Survives a reload.
 *
 * A refresh mid-setup would otherwise drop the user straight into the
 * application with no password set — silently bypassing the very step this
 * exists to enforce. Session storage, not local: it should not outlive the
 * browser tab.
 */
function persist(kind: SetupKind): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // Private browsing can refuse storage. The in-memory value below still
    // covers the normal, no-reload path.
  }
}

function restore(): SetupKind | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return v === "invite" || v === "recovery" ? v : null;
  } catch {
    return null;
  }
}

// Evaluated once, at import time, before the Supabase client exists.
const captured: SetupKind | null = (() => {
  const fromHash = readFromHash();
  if (fromHash) {
    persist(fromHash);
    return fromHash;
  }
  return restore();
})();

let active: SetupKind | null = captured;

/** Which setup the user arrived for, or null for an ordinary visit. */
export function pendingSetup(): SetupKind | null {
  return active;
}

/**
 * Called once the password has actually been saved.
 *
 * Only after updateUser succeeds — clearing it earlier would let an incomplete
 * setup through, which is the bug this module exists to prevent.
 */
export function completeSetup(): void {
  active = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was unavailable.
  }
}
