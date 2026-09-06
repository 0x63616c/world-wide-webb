import { type ReactNode, useEffect, useRef, useState } from "react";
import { BentoHome, TILE_SIZES, type TileId } from "./BentoHome";
import "./bento-preview.css";

const VARIATIONS = ["a", "b", "c"] as const;
const NAMES = {
  clock: ["Digital + analog", "Face first", "Big time"],
  lamps: ["Room scenes", "Room list", "Room buttons"],
  climate: ["Dial + modes", "Central dial", "Temperature first"],
  sonos: ["Source + shortcuts", "Now playing", "Source rail"],
  fan: ["Airflow", "Quick switch", "Power tile"],
  weather: ["Cloud study", "Temperature first", "Centered sky"],
  forecast: ["Hourly line", "Side caption", "Hourly points"],
} as const;
const REVIEW: Record<
  TileId,
  { pick: "a" | "b" | "c"; yours?: boolean; keep: string; change: string }
> = {
  clock: {
    pick: "a",
    yours: true,
    keep: "Large time and the simple sweeping face.",
    change: "Keep the date quiet and the face free of shadows.",
  },
  lamps: {
    pick: "c",
    yours: true,
    keep: "Room buttons make each zone distinct.",
    change: "Color stays in Bedroom and Living room; the power button covers everything.",
  },
  climate: {
    pick: "b",
    keep: "A compact dial with temperature controls close together.",
    change: "Heat is red, Cool is blue, and the ring now responds to dragging.",
  },
  sonos: {
    pick: "b",
    keep: "Desk / TV and one master volume control.",
    change: "Use the softer inverted palette; omit grouping metadata.",
  },
  fan: {
    pick: "a",
    keep: "Airflow represents the built-in fan.",
    change: "Keep it to one action; the freestanding fan is gone.",
  },
  weather: {
    pick: "b",
    yours: true,
    keep: "Temperature first, with soft clouds as the illustration.",
    change: "Let the illustration fill the extra width without adding text.",
  },
  forecast: {
    pick: "a",
    keep: "Temperature and feels-like on the same scale.",
    change: "The taller, narrower card gives both lines space. Hover or tap an hour.",
  },
};
const LAYOUT_URL = "/iframe.html?id=prototypes-bento-home--white&viewMode=story";
const DARK_URL = "/iframe.html?id=prototypes-bento-home--dark&viewMode=story";
const STUDIES_URL = "/iframe.html?id=prototypes-bento-home--tile-studies&viewMode=story";
function PreviewNav({ studies = false, dark = false }: { studies?: boolean; dark?: boolean }) {
  return (
    <header className="bp-nav">
      <span className="bp-brand">
        Home studies<span>Interactive design preview</span>
      </span>
      <nav aria-label="Preview pages">
        <a href={LAYOUT_URL} aria-current={!studies && !dark ? "page" : undefined}>
          Light
        </a>
        <a href={DARK_URL} aria-current={dark ? "page" : undefined}>
          Dark
        </a>
        <a href={STUDIES_URL} aria-current={studies ? "page" : undefined}>
          All tiles
        </a>
      </nav>
    </header>
  );
}
function Fit({
  width,
  height,
  children,
  device = false,
}: {
  width: number;
  height: number;
  children: ReactNode;
  device?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () =>
      setScale(
        Math.min(
          1,
          element.clientWidth / width,
          device ? Math.max(200, window.innerHeight - 124) / height : 1,
        ),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [width, height, device]);
  return (
    <div ref={ref} className="bp-fit">
      <div className="bp-fit-space" style={{ width: width * scale, height: height * scale }}>
        <div className="bp-fit-canvas" style={{ width, height, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
export function DevicePreview({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`bp-page bp-device-page ${dark ? "bp-dark" : ""}`}>
      <PreviewNav dark={dark} />
      <div className="bp-device-stage">
        <Fit width={1406} height={1064} device>
          <div className="bp-ipad">
            <span className="bp-camera" />
            <div className="bp-display">
              <BentoHome theme={dark ? "dark" : "light"} />
            </div>
          </div>
        </Fit>
      </div>
    </div>
  );
}
export function TileStudiesPreview() {
  return (
    <div className="bp-page bp-studies-page">
      <PreviewNav studies />
      <div className="bp-study-intro">
        <h1>Every tile. A few different ways.</h1>
        <nav aria-label="Jump to a tile">
          {Object.entries(TILE_SIZES).map(([id, tile]) => (
            <a key={id} href={`#${id}`}>
              {tile.name}
            </a>
          ))}
        </nav>
      </div>
      <div className="bp-studies">
        {Object.entries(TILE_SIZES).map(([id, tile]) => {
          const tileId = Object.keys(TILE_SIZES).find((key): key is TileId => key === id);
          if (!tileId) return null;
          return (
            <section className="bp-study" id={id} key={id}>
              <div className="bp-study-heading">
                <h2>{tile.name}</h2>
                <span>
                  {tile.width} × {tile.height} · panel size
                </span>
              </div>
              <div className="bp-study-grid">
                {VARIATIONS.map((variation, index) => (
                  <article
                    key={variation}
                    className={`bp-example ${REVIEW[tileId].pick === variation ? "bp-recommended" : ""}`}
                  >
                    <div className="bp-example-label">
                      <span>{variation.toUpperCase()}</span>
                      <h3>{NAMES[tileId][index]}</h3>
                      {REVIEW[tileId].pick === variation && (
                        <strong className="bp-pick">
                          {REVIEW[tileId].yours ? "Your pick" : "My pick"}
                        </strong>
                      )}
                      <a
                        href={`/iframe.html?id=prototypes-bento-home--tile-focus&viewMode=story&tile=${tileId}&variant=${variation}`}
                        aria-label={`Open ${tile.name} ${variation.toUpperCase()}`}
                      >
                        Open ↗
                      </a>
                    </div>
                    <Fit width={tile.width} height={tile.height}>
                      <BentoHome tile={tileId} variation={variation} />
                    </Fit>
                  </article>
                ))}
              </div>
              <div className="bp-review">
                <p>
                  <strong>Keep</strong> {REVIEW[tileId].keep}
                </p>
                <p>
                  <strong>Refine</strong> {REVIEW[tileId].change}
                </p>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function TileFocusPreview() {
  const params = new URLSearchParams(window.location.search);
  const tile =
    Object.keys(TILE_SIZES).find((key): key is TileId => key === params.get("tile")) ?? "climate";
  const variation = VARIATIONS.find((key) => key === params.get("variant")) ?? "a";
  const size = TILE_SIZES[tile];
  return (
    <div className="bp-page">
      <PreviewNav studies />
      <div className="bp-focus">
        <h1>{size.name}</h1>
        <nav aria-label="Tile variations">
          {VARIATIONS.map((key, index) => (
            <a
              key={key}
              aria-current={key === variation ? "page" : undefined}
              href={`/iframe.html?id=prototypes-bento-home--tile-focus&viewMode=story&tile=${tile}&variant=${key}`}
            >
              {key.toUpperCase()} · {NAMES[tile][index]}
            </a>
          ))}
        </nav>
        <Fit width={size.width} height={size.height}>
          <BentoHome tile={tile} variation={variation} />
        </Fit>
      </div>
    </div>
  );
}
