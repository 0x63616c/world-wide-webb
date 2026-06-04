import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenMeteoBundle } from "../services/weather-ingest-service";

afterEach(() => vi.restoreAllMocks());

function bundleResponse() {
  return {
    current: {
      time: "2026-06-04T18:00",
      temperature_2m: 72.4,
      apparent_temperature: 70.1,
      relative_humidity_2m: 58,
      weather_code: 2,
      wind_speed_10m: 9.3,
      is_day: 1,
      uv_index: 6.4,
    },
    hourly: {
      time: ["2026-06-04T17:00", "2026-06-04T18:00", "2026-06-04T19:00"],
      temperature_2m: [70, 72, 71],
      apparent_temperature: [68, 70, 69],
      relative_humidity_2m: [60, 58, 59],
      weather_code: [1, 2, 3],
      wind_speed_10m: [8, 9, 10],
      is_day: [1, 1, 0],
      precipitation_probability: [5, 10, 15],
    },
    daily: {
      time: ["2026-06-04", "2026-06-05"],
      temperature_2m_max: [80, 81],
      temperature_2m_min: [60, 61],
      weather_code: [2, 3],
      precipitation_probability_max: [20, 30],
      sunrise: ["2026-06-04T05:14", "2026-06-05T05:15"],
      sunset: ["2026-06-04T20:07", "2026-06-05T20:08"],
    },
  };
}

describe("fetchOpenMeteoBundle", () => {
  it("makes one request and returns parsed current/hourly/daily", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(bundleResponse()), { status: 200 }));

    const bundle = await fetchOpenMeteoBundle(34.0537, -118.2428);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bundle.hourly.time).toHaveLength(3);
    expect(bundle.daily.sunrise[0]).toBe("2026-06-04T05:14");
    expect(bundle.current.temperature_2m).toBe(72.4);
  });

  it("throws on non-OK upstream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 502 }));
    await expect(fetchOpenMeteoBundle(0, 0)).rejects.toThrow("HTTP 502");
  });
});
