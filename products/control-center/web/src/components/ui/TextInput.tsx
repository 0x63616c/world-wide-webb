/**
 * TextInput , standalone dumb presentational single-line text field.
 * Zero trpc/data/hook dependencies; all state driven by props. Styled to match
 * the logs viewer's search input so text controls read as one family. The
 * `label` is the accessible name , the control has no visible text of its own
 * (the surrounding field supplies the on-screen label).
 */

export interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Accessible name , the control has no visible text of its own. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

export function TextInput({ value, onChange, label, placeholder, disabled }: TextInputProps) {
  return (
    <input
      type="text"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 36,
        padding: "0 12px",
        margin: 0,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        borderRadius: 10,
        color: "var(--ink-1)",
        fontFamily: "var(--ui)",
        fontSize: 14,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "text",
      }}
    />
  );
}
