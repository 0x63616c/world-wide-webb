interface SkeletonProps {
  w: number | string;
  h?: number | string;
  borderRadius?: number;
}

export function Skeleton({ w, h = 14, borderRadius = 6 }: SkeletonProps) {
  return (
    <div
      style={{
        width: typeof w === "number" ? w : w,
        height: h,
        borderRadius,
        background: "linear-gradient(90deg, var(--tile-2) 25%, var(--nest) 50%, var(--tile-2) 75%)",
        backgroundSize: "200%",
        animation: "shimmer 1.6s linear infinite",
      }}
    />
  );
}
