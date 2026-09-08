import { originalFilesLabel } from "@/lib/format";
import type { CallRecordingFiles } from "@/lib/recordingFiles";

/**
 * The original upload filename, as secondary metadata under a call's title.
 *
 * Muted and one step down in size, deliberately: the generated title is the
 * call's name and stays primary. Renders nothing at all when there is no
 * recording, rather than an empty line or a dash.
 *
 * The full list is always in the title attribute, so a long list that the
 * layout truncates is still readable on hover.
 */
export function OriginalFileLine({
  files,
  className,
}: {
  files: CallRecordingFiles | undefined;
  className?: string;
}): JSX.Element | null {
  const label = files
    ? originalFilesLabel(files.recording_filenames ?? [], files.recording_file_count)
    : null;
  if (!label) return null;
  return (
    <span
      className={className ?? "block text-[11.5px] text-ink-45 mt-0.5 truncate"}
      title={label}
    >
      {label}
    </span>
  );
}
