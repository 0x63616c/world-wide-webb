import { trpc } from "@/lib/trpc";
import { Icon } from "../Icon";
import { Skeleton } from "../ui/Skeleton";

interface EventRow {
  name: string;
  place: string;
  days: number;
}

function Sec({
  icon,
  children,
  right,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      {icon}
      <span
        style={{
          fontSize: 17.5,
          fontWeight: 600,
          letterSpacing: "-.015em",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

function EventItem({ event, first }: { event: EventRow; first: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        paddingLeft: first ? 0 : 22,
        paddingRight: 14,
        borderLeft: first ? "none" : "1px solid var(--hair)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 9 }}>
        <span
          className="mono"
          style={{
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 0.82,
            color: event.days <= 3 ? "var(--acc)" : "var(--ink)",
          }}
        >
          {event.days}
        </span>
        <span className="cap" style={{ fontSize: 11 }}>
          days
        </span>
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {event.name}
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--ink-3)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          marginTop: 2,
        }}
      >
        {event.place}
      </div>
    </div>
  );
}

function EventsSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "stretch", width: "100%", gap: 12 }}>
      <Skeleton w="33%" h={72} borderRadius={8} />
      <Skeleton w="33%" h={72} borderRadius={8} />
      <Skeleton w="33%" h={72} borderRadius={8} />
    </div>
  );
}

export function EventsTile() {
  const { data } = trpc.events.list.useQuery(undefined, {
    refetchInterval: 30 * 60 * 1000, // 30 min
  });

  return (
    <div
      className="tile"
      style={{
        height: "100%",
        padding: 22,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <Sec
        icon={<Icon name="calendar" s={19} c="var(--ink-2)" />}
        right={
          <span className="cap" style={{ display: "flex", alignItems: "center", gap: 3 }}>
            All <Icon name="chevron" s={12} c="var(--ink-3)" />
          </span>
        }
      >
        Upcoming
      </Sec>
      {!data ? (
        <EventsSkeleton />
      ) : (
        <div style={{ display: "flex", alignItems: "stretch", width: "100%" }}>
          {data.slice(0, 3).map((e, i) => (
            <EventItem key={`${e.name}-${e.place}-${e.days}`} event={e} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
