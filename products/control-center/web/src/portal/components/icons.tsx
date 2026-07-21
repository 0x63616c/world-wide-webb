// Icon set + Logo, ported 1:1 (shapes) from
// products/captive-portal/apps/frontend/src/components/icons.tsx, restyled
// onto the cc idiom: no CSS classes, explicit `size` (px) + `currentColor`
// stroke so a bare <svg> always renders at a sane size without theme.css
// (which the guest bundle never imports, see ../portal.css). All icons are
// decorative (aria-hidden); color comes from the parent's CSS `color`.
type IconProps = { size?: number };

/** @public , none of the 8 shipped screens use GlobeMark/Logo directly (Logo
 *  wraps it), but it's the mark for the unshipped LandingSplit variant; ported
 *  1:1 alongside the rest of the icon set. */
export function GlobeMark({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.4 3.9 5.6 3.9 9s-1.4 6.6-3.9 9c-2.5-2.4-3.9-5.6-3.9-9s1.4-6.6 3.9-9Z" />
    </svg>
  );
}

/** @public , unused by the 8 shipped screens (email/OTP was dropped, www-p9hx);
 *  ported 1:1 alongside the rest of the icon set for future screens. */
export function MailIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 7.3 5.2a2 2 0 0 0 2.4 0L20.5 7" />
    </svg>
  );
}

/** @public , unused by the 8 shipped screens; ported 1:1 alongside the rest of
 *  the icon set for future screens. */
export function UserIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  );
}

export function AlertIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}

export function CheckIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="m4 12.5 5 5 11-11" />
    </svg>
  );
}

export function ArrowLeft({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** @public , unused by the 8 shipped screens (only ArrowLeft, on Terms, ships
 *  today); ported 1:1 alongside the rest of the icon set for future screens. */
export function ArrowRight({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function WifiIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M2 8.5C8 3.5 16 3.5 22 8.5" />
      <path d="M5 12c4-3.3 10-3.3 14 0" />
      <path d="M8.5 15.5c2.1-1.7 4.9-1.7 7 0" />
      <path d="M12 19h.01" />
    </svg>
  );
}

export function LockIcon({ size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

/** @public , the LandingSplit variant's wordmark lockup; unused by the 8
 *  shipped screens, ported 1:1 alongside the rest of the icon set.
 *  Logo mark, the GlobeMark inside a rounded gradient tile. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 12,
        background: "linear-gradient(180deg, var(--nest) 0%, var(--bg) 100%)",
        border: "1px solid var(--hair-2)",
        color: "var(--ink)",
      }}
    >
      <GlobeMark size={Math.round(size * 0.55)} />
    </span>
  );
}
