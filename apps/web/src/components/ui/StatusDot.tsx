interface StatusDotProps {
  online?: boolean;
}

export function StatusDot({ online }: StatusDotProps) {
  if (online) {
    return <span className="dot" />;
  }
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--ink-3)",
        display: "inline-block",
      }}
    />
  );
}
