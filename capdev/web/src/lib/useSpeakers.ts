import { useEffect, useState } from "react";
import { speakersForCall, type SpeakerMap } from "./speakers";

/**
 * The canonical speaker mapping for a call, for any component that renders
 * transcript-derived text.
 *
 * Deliberately a shared hook rather than a prop threaded through each screen:
 * a surface that forgets to ask gets no names at all, which is visible, rather
 * than a stale private copy, which is not.
 */
export function useSpeakers(callId: string | null | undefined): SpeakerMap {
  const [speakers, setSpeakers] = useState<SpeakerMap>({});

  useEffect(() => {
    if (!callId) {
      setSpeakers({});
      return;
    }
    let cancelled = false;
    void speakersForCall(callId).then((map) => {
      if (!cancelled) setSpeakers(map);
    });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  return speakers;
}
