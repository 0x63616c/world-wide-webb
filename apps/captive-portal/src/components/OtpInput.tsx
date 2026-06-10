import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";
import { cn } from "@/lib/utils";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires once all `length` digits are entered — trigger verification here. */
  onComplete?: (value: string) => void;
  error?: boolean;
  disabled?: boolean;
  length?: number;
}

function Slot({ slot, error }: { slot: SlotProps; error?: boolean }) {
  return (
    <div
      className={cn(
        "wwb-otp-box",
        slot.char != null && "is-filled",
        slot.isActive && "is-active",
        error && "is-error",
      )}
    >
      {slot.char}
      {slot.hasFakeCaret && <span className="wwb-otp-caret" aria-hidden="true" />}
    </div>
  );
}

/** Six digit boxes that behave as one field — auto-advance, paste-to-fill,
 *  backspace, arrow nav, numeric-only — built on shadcn `input-otp` (the hidden
 *  single input owns all keyboard/paste behaviour). The first/only input is
 *  autocomplete="one-time-code" so iOS/Android SMS autofill works. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  length = 6,
}: OtpInputProps) {
  return (
    <OTPInput
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      maxLength={length}
      disabled={disabled}
      // No password-manager badge: it's noise on a one-time code field, and its
      // probe (document.elementFromPoint) isn't available in jsdom.
      pushPasswordManagerStrategy="none"
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="Verification code"
      containerClassName="wwb-otp"
      render={({ slots }) => (
        <>
          {slots.map((slot, i) => (
            // Slots are fixed-position digit boxes; index is a stable key here.
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length slot row
            <Slot key={i} slot={slot} error={error} />
          ))}
        </>
      )}
    />
  );
}
