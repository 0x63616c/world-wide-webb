import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_HOURLY, fetchWeatherHourly, fetchWeatherNow } from "../services/weather-service";

// ---- helpers ----------------------------------------------------------------

function makeCurrentResponse() {
  return {
    current: {
      temperature_2m: 72.4,
      apparent_temperature: 70.1,
      relative_humidity_2m: 58.0,
      weather_code: 2,
      wind_speed_10m: 9.3,
      is_day: 1,
    },
    daily: {
      temperature_2m_max: [80.1, 81.0],
      temperature_2m_min: [60.5, 61.0],
      sunset: ["2024-06-01T20:07", "2024-06-02T20:08"],
      sunrise: ["2024-06-01T05:14", "2024-06-02T05:15"],
    },
  };
}

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFetchFail() {
  return vi.fn().mockRejectedValue(new Error("network error"));
}

// ---- tests ------------------------------------------------------------------

describe("fetchWeatherNow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchOk(makeCurrentResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns mapped weather data from API", async () => {
    const result = await fetchWeatherNow(34.0537, -118.2428);

    expect(result.temp).toBe(72);
    expect(result.feels).toBe(70);
    expect(result.hum).toBe(58);
    expect(result.wind).toBe(9);
    expect(result.hi).toBe(80);
    expect(result.lo).toBe(61);
    expect(result.cond).toBe("Partly Cloudy");
    expect(result.sunset).toBe("8:07 PM");
    expect(result.sunsetIso).toBe("2024-06-01T20:07");
    expect(result.sunrise).toBe("5:14 AM");
    expect(result.sunriseIso).toBe("2024-06-01T05:14");
    expect(result.tomorrowSunriseIso).toBe("2024-06-02T05:15");
    expect(result.city).toBe("Los Angeles");
  });

  it("calls Open-Meteo with fahrenheit + mph units", async () => {
    await fetchWeatherNow(34.0537, -118.2428);
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("temperature_unit=fahrenheit");
    expect(url).toContain("wind_speed_unit=mph");
    expect(url).toContain("timezone=auto");
  });

  it("includes required current fields in request", async () => {
    await fetchWeatherNow(34.0537, -118.2428);
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("apparent_temperature");
    expect(url).toContain("relative_humidity_2m");
    expect(url).toContain("wind_speed_10m");
    expect(url).toContain("is_day");
    expect(url).toContain("sunset");
    expect(url).toContain("sunrise");
    // Needs 2 forecast days to get tomorrow's sunrise
    expect(url).toContain("forecast_days=2");
  });

  it("throws when fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    await expect(fetchWeatherNow(34.0537, -118.2428)).rejects.toThrow();
  });

  it("throws on non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchWeatherNow(34.0537, -118.2428)).rejects.toThrow("HTTP 500");
  });
});

describe("fetchWeatherHourly", () => {
  it("returns 12 items (DEMO_HOURLY)", async () => {
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result).toHaveLength(12);
  });

  it("first item is labeled Now", async () => {
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result[0].t).toBe("Now");
  });

  it("items include temp, feels, and ic fields", async () => {
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    for (const item of result) {
      expect(typeof item.temp).toBe("number");
      expect(typeof item.feels).toBe("number");
      expect(["sun", "moon", "cloud", "cloud-sun"]).toContain(item.ic);
    }
  });

  it("returns identical reference to DEMO_HOURLY", async () => {
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result).toBe(DEMO_HOURLY);
  });
});

// ---------------------------------------------------------------------------
// DEMO_HOURLY shape — always-on demo payload for the Next12Hours tile
// ---------------------------------------------------------------------------

describe("DEMO_HOURLY", () => {
  it("has exactly 12 items", () => {
    expect(DEMO_HOURLY).toHaveLength(12);
  });

  it("first item is labeled Now", () => {
    expect(DEMO_HOURLY[0].t).toBe("Now");
  });

  it("all items have numeric temp and feels fields", () => {
    for (const item of DEMO_HOURLY) {
      expect(typeof item.temp).toBe("number");
      expect(typeof item.feels).toBe("number");
    }
  });

  it("all items have a valid icon value", () => {
    const validIcons = ["sun", "moon", "cloud", "cloud-sun"];
    for (const item of DEMO_HOURLY) {
      expect(validIcons).toContain(item.ic);
    }
  });

  it("temperatures are realistic (between 40°F and 110°F for LA)", () => {
    for (const item of DEMO_HOURLY) {
      expect(item.temp).toBeGreaterThanOrEqual(40);
      expect(item.temp).toBeLessThanOrEqual(110);
    }
  });

  it("has varied temperatures across the 12 hours (not all identical)", () => {
    const temps = DEMO_HOURLY.map((h) => h.temp);
    const unique = new Set(temps);
    expect(unique.size).toBeGreaterThan(1);
  });
});
