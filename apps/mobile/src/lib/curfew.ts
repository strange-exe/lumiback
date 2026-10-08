import { formatMinutes, formatTime } from "@/lib/time";

/** `GET /campus`: tonight's curfew on the campus clock. */
export interface Campus {
  curfew: string; // "21:30"
  curfew_at: string; // today's curfew, ISO with the IST offset
}

export interface CurfewLine {
  title: string;
  detail: string;
  /** Under an hour to go, or already past: worth a second look. */
  urgent: boolean;
}

/**
 * The Tonight line on Today:
 *   "Gates close at 9:30 PM" / "In 2 h 10 min"
 *   "Gates closed at 9:30 PM" / "Heading out now? Pick your return time when you scan."
 */
export function curfewLine(campus: Campus, nowMs: number): CurfewLine {
  const at = Date.parse(campus.curfew_at);
  const time = formatTime(campus.curfew_at);
  const minutes = Math.ceil((at - nowMs) / 60_000);
  if (minutes <= 0) {
    return {
      title: `Gates closed at ${time}`,
      detail: "Heading out now? Pick your return time when you scan.",
      urgent: true,
    };
  }
  return {
    title: `Gates close at ${time}`,
    detail: `In ${formatMinutes(minutes)}`,
    urgent: minutes <= 60,
  };
}
