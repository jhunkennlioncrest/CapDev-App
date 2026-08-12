/** Durations are stored in milliseconds throughout (Domain Blueprint §B). */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "—";
  const mb = bytes / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Reads duration from the audio file itself, in the browser, before upload.
 * Best-effort: some formats or codecs will not report it, and that is fine —
 * the column is nullable and the real value arrives with the transcript later.
 */
export function readAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null): void => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.addEventListener("loadedmetadata", () => {
      const seconds = audio.duration;
      done(Number.isFinite(seconds) ? Math.round(seconds * 1000) : null);
    });
    audio.addEventListener("error", () => done(null));
    setTimeout(() => done(null), 10_000);
    audio.src = url;
  });
}
