import { Icon } from "@/components/Icon";
import { Skeleton, Tile, TileHeader, type TileStatus } from "@/components/ui";

export interface EventRow {
  name: string;
  place: string;
  days: number;
}

export type EventsTileStatus = TileStatus;

export interface EventsTileViewProps {
  status: EventsTileStatus;
  events: EventRow[];
}

function EventItem({
  event,
  first,
  nearest,
}: {
  event: EventRow;
  first: boolean;
  nearest: boolean;
}) {
  // Accent green for the nearest upcoming event OR any event within 3 days
  const dayColor = nearest || event.days <= 3 ? "var(--acc)" : "var(--ink)";

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
            color: dayColor,
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

export function EventsTileView({ status, events }: EventsTileViewProps) {
  const showSkeleton = status !== "populated" || events.length === 0;
  const visible = events.slice(0, 3);

  return (
    <Tile padding={22}>
      <TileHeader
        icon="calendar"
        title="Upcoming"
        right={
          <span className="cap" style={{ display: "flex", alignItems: "center", gap: 3 }}>
            All <Icon name="chevron" s={12} c="var(--ink-3)" />
          </span>
        }
      />
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        {showSkeleton ? (
          <EventsSkeleton />
        ) : (
          <div style={{ display: "flex", alignItems: "stretch", width: "100%" }}>
            {visible.map((e, i) => (
              <EventItem
                key={`${e.name}-${e.place}-${e.days}`}
                event={e}
                first={i === 0}
                // Index 0 is always the soonest event (data arrives pre-sorted)
                nearest={i === 0}
              />
            ))}
          </div>
        )}
      </div>
    </Tile>
  );
}
