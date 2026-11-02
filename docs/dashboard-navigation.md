# Dashboard escape controls (WWW-86)

The web dashboard has one route (`apps/web/src/routes/index.tsx`); sub-screens
are body portals and feature-local views, rather than browser history entries.
Back never calls `history.back()`, which could leave the kiosk app.

`apps/web/src/components/ui/BackPill.tsx` is the shared web navigation primitive.
It stays in its surface's stacking context, fixed 24px plus the left/bottom safe
areas from the viewport edges, with a 56px minimum height, visible chevron and
label, and contrasting theme colors. Scrolling page bodies reserve 104px plus
bottom safe area so their last controls can scroll above it.

`useBackNavigation` joins the existing Escape stack. Escape and a single-finger
right swipe starting within 24px of the left viewport edge dismiss only the
surface that was topmost when the gesture began. Swipes require more than 80px
of travel and twice as much horizontal as vertical travel. Vertical drags,
non-edge scrolling, slider/input gestures, multi-touch and cancellations do not
navigate. Callback updates do not reorder the stack; unmount removes handlers.
The previous back controls had no sound/haptic callbacks to preserve.

## Screen inventory

Paths below are relative to the repository root. Navigation is supplied by the
shared shell where a feature is a bare page body.

| Screen / overlay | Source | Exit |
| --- | --- | --- |
| Controls expanded page | `features/ctrl/web/ExpandedControlsView.tsx`, `features/ctrl/web/wiring/controls.tsx` | Tile Detail Host pill → board |
| Saved-color editor | `features/ctrl/web/ExpandedControlsView.tsx` | Close color editor pill → Controls; Cancel and Save & use remain |
| Sound System | `features/sound/web/SoundSystemPage.tsx`, `features/sound/web/wiring/sound.tsx` | Tile Detail Host pill → board |
| Alarms list, add/edit alarm, inline delete confirmation | `features/events/web/AlarmsPage.tsx`, `features/events/detail.ts` | Tile Detail Host pill → board; Cancel / Keep alarm return to list |
| Tile Detail Host, including loading states | `apps/web/src/components/tiles/detail/TileDetailHost.tsx` | Pill → board, including full-bleed loading |
| Activity grid and sessions list | `features/wakes/web/ActivityPage.tsx`, `features/wakes/web/SessionListView.tsx`, `features/wakes/web/wiring/activity.tsx` | PageHeader pill → board in both modes; no separate session transcript page |
| Photo booth camera, including permission/error states | `features/booth/web/BoothCamera.tsx`, `features/booth/web/BoothCameraControls.tsx`, `features/booth/web/PhotoBoothPager.tsx` | Pill → board |
| Photo booth gallery | `features/booth/web/BoothGallery.tsx`, `features/booth/web/PhotoBoothPager.tsx` | Back to camera pill → camera → board |
| Photo booth lightbox | `features/booth/web/BoothGallery.tsx` | Back to photos pill → gallery → camera → board |
| Photo booth filters | `features/booth/web/BoothCameraControls.tsx` | Modal Close pill → camera |
| Delete photo confirmation | `features/booth/web/BoothGallery.tsx`, `apps/web/src/components/ui/ConfirmDialog.tsx` | Modal Close pill / Cancel → lightbox or gallery |
| Wi-Fi enlarged QR | `features/wifi/web/WifiTile.tsx` | Modal Close pill → board |
| Settings list; Device, Display, Security, Time pages | `apps/web/src/components/settings-page/SettingsPage.tsx`, `apps/web/src/components/settings-page/pages/{Device,Display,Security,Time}Page.tsx` | Pill → board on panel; on phone, page → Settings list → board |
| Reset settings confirmation | `apps/web/src/components/settings-page/pages/DevicePage.tsx`, `apps/web/src/components/ui/ConfirmDialog.tsx` | Modal Close pill / Cancel → Device |
| Settings / Activity / Photo Booth PIN gates | `apps/web/src/components/pin/PinGateModal.tsx`, `apps/web/src/components/pin/PinModalShell.tsx` | Back pill / Cancel → previous surface |
| Change PIN: current, new, confirm stages | `apps/web/src/components/pin/PinChangeModal.tsx`, `apps/web/src/components/pin/PinModalShell.tsx` | Back pill / Cancel → Security |
| Spirit level | `apps/web/src/components/LevelOverlay.tsx`, `apps/web/src/components/LevelOverlayView.tsx` | Back to Settings pill, or tap background → Device |
| Shared headers and dialogs | `apps/web/src/components/ui/{PageHeader,Modal,ConfirmDialog}.tsx` | Pill inherited by current and future consumers |

## Operational overlays

These already have large reachable exit controls and keep their operating semantics:

- Cleaning mode (`apps/web/src/components/CleanScreenOverlay.tsx`,
  `CleanScreenOverlayView.tsx`): centered 320×64 Hold to exit; 10-minute timeout.
  It consumes navigation gestures so wiping cannot close Settings underneath it.
- Ringing alarm (`features/events/web/AlarmRuntime.tsx`): centered 72px-tall
  Stop / Snooze actions acknowledge the server alarm and dismiss its alert.
  There is no generic back action that silently acknowledges a ringing alarm.
- Idle dim (`apps/web/src/components/ui/DimOverlay.tsx`): tap anywhere wakes the
  board. It is not a navigated sub-screen.

## Dead ends found

Activity's full-bleed loading state previously rendered no visible exit at all
(the host only installed a raw Escape listener). It now renders the pill before
data arrives. The generic full-bleed loading fallback covers future entries too.
The photo lightbox previously had only an invisible scrim and Escape; it now has
a visible pill. No ordinary navigation screen remains without a path home.

## Visual evidence

Before/after PNGs were captured at 1366×1024 in `/workspace/shots/WWW-86/`.
They render the production Settings Device page, Activity PIN gate, and Controls
loading shell in a temporary Vite component harness, using local device state
and the actual loading UI without a backend. The harness was removed afterward;
screenshots are deliberately uncommitted per the ticket instructions.
