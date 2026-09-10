/**
 * Quick Listen source fingerprint (0075 Phase 2).
 *
 * A digest is STALE when the source it was built from has changed. This module
 * turns "the source state" into one short string, so staleness is a string
 * comparison rather than a judgement call.
 *
 * The rules it has to satisfy:
 *
 *   - deterministic: the same unchanged source state always produces the same
 *     fingerprint, on any machine, in any locale, in any Deno or Node version;
 *   - sensitive: any change to the state Phase 1 documented must change it;
 *   - free of volatile input: nothing about WHEN the fingerprint was computed
 *     may enter it. No clock, no requested_at, no attempt counter.
 *
 * Nothing here touches the network or the database. It is pure so it can be
 * run against real rows and asserted, which is what Phase 2's test N does.
 */

/**
 * Recipe version, carried in the fingerprint itself.
 *
 * The fingerprint is a claim about a comparison. If the canonical structure
 * below ever changes, an old fingerprint and a new one are answers to
 * different questions, and comparing them for equality would silently reuse a
 * digest built from a different notion of "unchanged". Putting the recipe in
 * the string makes them unequal by construction: every stored digest becomes
 * stale the moment the recipe changes, which is the correct and conservative
 * outcome. Bump this whenever the canonical structure changes.
 */
export const FINGERPRINT_RECIPE = "qlfp1";

export interface SpeakerEntry {
  label: string;
  name: string | null;
  role: string | null;
}

export interface SourceState {
  transcriptId: string;
  versionNo: number;
  kind: string;
  reviewedAt: string | null;
  updatedAt: string | null;
  segmentCount: number;
  speakers: SpeakerEntry[];
}

/* -------------------------------------------------------------------------- */
/* Timestamps                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A Postgres timestamptz, as an exact count of microseconds since the epoch.
 *
 * Date.parse() is NOT used, deliberately. Postgres/PostgREST can hand back
 * "2026-09-10T19:27:42.345389+00:00", "2026-09-10 19:27:42.345389+00" or
 * "...Z" depending on the path, and Date.parse's behaviour on the non-ISO
 * spellings is implementation-defined - the fingerprint would then depend on
 * which engine ran it. Date also truncates to milliseconds, which would fuse
 * two edits 300 microseconds apart into one fingerprint.
 *
 * So the string is parsed by hand, to the microsecond, and an unrecognised
 * shape throws rather than hashing something ambiguous. A fingerprint that is
 * wrong is worse than one that fails to be computed.
 */
export function canonicalTimestampMicros(raw: string | null): string | null {
  if (raw === null || raw === undefined) return null;

  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      raw.trim(),
    );
  if (!m) {
    throw new Error(`Unrecognised timestamp shape for fingerprinting: ${raw}`);
  }

  const [, y, mo, d, h, mi, s, frac, zone] = m;

  // Date.UTC is used only for the calendar arithmetic of whole seconds, which
  // is fully specified and engine-independent.
  const wholeMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );

  // Fractional seconds padded to exactly 6 digits, then truncated. Postgres
  // stores microseconds; anything finer than that cannot have come from the
  // database and is not information we should hash.
  const micros = BigInt(((frac ?? "") + "000000").slice(0, 6));

  let offsetMinutes = 0n;
  if (zone && zone !== "Z" && zone !== "z") {
    const sign = zone[0] === "-" ? -1n : 1n;
    const digits = zone.slice(1).replace(":", "");
    const oh = BigInt(digits.slice(0, 2));
    const om = digits.length > 2 ? BigInt(digits.slice(2, 4)) : 0n;
    offsetMinutes = sign * (oh * 60n + om);
  }

  const epochMicros =
    BigInt(wholeMs) * 1000n + micros - offsetMinutes * 60n * 1000n * 1000n;

  return epochMicros.toString();
}

/* -------------------------------------------------------------------------- */
/* Canonical JSON                                                              */
/* -------------------------------------------------------------------------- */

/**
 * JSON with every object key sorted and no insignificant whitespace.
 *
 * Object key order in JavaScript is insertion order, which means an innocuous
 * refactor that builds the same object in a different order would change the
 * hash. Sorting removes that. The sort is Array.prototype.sort's default -
 * UTF-16 code unit order, specified and identical everywhere - and NOT
 * localeCompare, which depends on the ICU version the runtime was built
 * against. (0071 lost an afternoon to exactly that: the same format call
 * produced "Sept" on one ICU and "Sep" on another.)
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";

  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";

  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("Non-finite number cannot be canonicalised");
    }
    if (!Number.isInteger(value as number)) {
      // Every number entering the fingerprint is a count or a version. A float
      // would raise the question of how many digits to keep, and there is no
      // answer to that which is stable across engines.
      throw new Error(`Non-integer number cannot be canonicalised: ${value}`);
    }
    return String(value);
  }

  if (t === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
        .join(",") +
      "}"
    );
  }

  throw new Error(`Cannot canonicalise value of type ${t}`);
}

/* -------------------------------------------------------------------------- */
/* The canonical source structure                                              */
/* -------------------------------------------------------------------------- */

/**
 * The exact structure that gets hashed. Written out rather than derived, so it
 * can be read and argued with.
 *
 *   {
 *     "kind":            transcript.kind,
 *     "recipe":          FINGERPRINT_RECIPE,
 *     "reviewed_at_us":  transcript.reviewed_at as epoch microseconds, or null,
 *     "segment_count":   transcript.segment_count,
 *     "speakers":        [ {label, name, role}, ... ] sorted by label,
 *     "transcript_id":   transcript.id, lowercased,
 *     "updated_at_us":   transcript.updated_at as epoch microseconds, or null,
 *     "version_no":      transcript.version_no
 *   }
 *
 * (canonicalJson sorts the keys, so that listing is already alphabetical.)
 *
 * Two deliberate exclusions:
 *
 *   - speakers[].representative_id. It links a speaker to a person row; it does
 *     not change who is speaking or what they say, so a digest built before it
 *     was set is not stale because of it.
 *
 *   - the transcript segments themselves. segment_count plus updated_at stand
 *     in for them: any edit to segments bumps updated_at through the house
 *     set_updated_at trigger. Hashing several hundred segments on every
 *     eligibility check would cost far more than it buys, and would make the
 *     fingerprint depend on segment JSON key order, which nothing guarantees.
 *
 * One deliberate over-sensitivity, stated plainly: updated_at moves on ANY
 * update to the transcript row, including one that changes nothing a listener
 * would notice. A digest can therefore be reported stale when its content
 * would have been identical. That errs toward regenerating something that did
 * not need it, which is a cost; the opposite error is serving a condensed call
 * that no longer matches the transcript, which is a correctness failure. The
 * cheap error is the right one to make.
 */
export function buildFingerprintInput(state: SourceState): string {
  const speakers = state.speakers
    .map((s) => ({
      label: s.label,
      name: s.name,
      role: s.role,
    }))
    // UTF-16 code unit order, per canonicalJson's note.
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  return canonicalJson({
    recipe: FINGERPRINT_RECIPE,
    transcript_id: state.transcriptId.toLowerCase(),
    version_no: state.versionNo,
    kind: state.kind,
    reviewed_at_us: canonicalTimestampMicros(state.reviewedAt),
    updated_at_us: canonicalTimestampMicros(state.updatedAt),
    segment_count: state.segmentCount,
    speakers,
  });
}

/**
 * Normalises the raw `transcript.speakers` map into the sorted list the
 * fingerprint uses. Whitespace is trimmed and an empty string becomes null, so
 * "" and "  " and absent are one state rather than three.
 */
export function speakerEntriesFrom(speakers: unknown): SpeakerEntry[] {
  if (speakers === null || typeof speakers !== "object" || Array.isArray(speakers)) {
    return [];
  }
  const map = speakers as Record<string, unknown>;
  const out: SpeakerEntry[] = [];
  for (const label of Object.keys(map)) {
    const raw = map[label];
    const entry = (raw && typeof raw === "object" && !Array.isArray(raw))
      ? (raw as Record<string, unknown>)
      : {};
    out.push({
      label: label.trim(),
      name: nullIfBlank(entry["name"]),
      role: nullIfBlank(entry["role"]),
    });
  }
  return out;
}

function nullIfBlank(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/* -------------------------------------------------------------------------- */
/* The hash                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * SHA-256 over the UTF-8 bytes of the canonical input, hex encoded, with the
 * recipe and algorithm carried in front:
 *
 *   qlfp1:sha256:3f2a...            (7 + 64 characters)
 *
 * Self-describing on purpose. A bare hex string in a column tells a future
 * reader nothing about how to reproduce it, and cannot be distinguished from a
 * hex string produced by a different recipe.
 *
 * Web Crypto, which Deno and Node 18+ both provide, so this module runs
 * unchanged inside the Edge Function and inside a plain test harness.
 */
export async function computeSourceFingerprint(
  state: SourceState,
): Promise<string> {
  const input = buildFingerprintInput(state);
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${FINGERPRINT_RECIPE}:sha256:${hex}`;
}
