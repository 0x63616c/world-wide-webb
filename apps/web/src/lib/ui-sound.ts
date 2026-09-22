/**
 * iOS system-sound paths retained as sound-bus cue metadata. The Expo shell
 * deliberately does not bridge private UISound files, so callers synthesize
 * their existing web fallback instead.
 */
export const UI_SOUND = {
  photoShutter: "/System/Library/Audio/UISounds/photoShutter.caf",
  alarm: "/System/Library/Audio/UISounds/alarm.caf",
  calendarAlertChord: "/System/Library/Audio/UISounds/Modern/calendar_alert_chord.caf",
} as const;

export function playUISound(_path: string): boolean {
  return false;
}
