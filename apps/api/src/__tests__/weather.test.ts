import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWeatherHourly, fetchWeatherNow } from "../services/weather-service";

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

// Build a realistic Open-Meteo hourly response spanning 48 hours, starting a
// few hours before "now" so the current-hour alignment lands mid-array.
function makeHourlyResponse() {
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = new Date();
  base.setMinutes(0, 0, 0);
  base.setHours(base.getHours() - 3);
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const apparent_temperature: number[] = [];
  const weather_code: number[] = [];
  const is_day: number[] = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(base.getTime() + i * 3_600_000);
    time.push(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`,
    );
    temperature_2m.push(70 + (i % 10));
    apparent_temperature.push(68 + (i % 10));
    weather_code.push(i % 3);
    is_day.push(d.getHours() >= 6 && d.getHours() < 18 ? 1 : 0);
  }
  return { hourly: { time, temperature_2m, apparent_temperature, weather_code, is_day } };
}

describe("fetchWeatherHourly", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchOk(makeHourlyResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 12 items starting at the current hour", async () => {
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result).toHaveLength(12);
  });

  it("labels the first slot Now and the rest with real clock hours", async () => {
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result[0].t).toBe("Now");
    // Subsequent labels are 12-hour clock numbers (1-12), derived from real time.
    for (const item of result.slice(1)) {
      const n = Number(item.t);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(12);
    }
  });

  it("maps temp, feels, and a valid icon for each slot", async () => {
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    for (const item of result) {
      expect(typeof item.temp).toBe("number");
      expect(typeof item.feels).toBe("number");
      expect(["sun", "moon", "cloud", "cloud-sun"]).toContain(item.ic);
    }
  });

  it("throws on non-OK HTTP response (tile shimmers, no fake data)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchWeatherHourly(34.0537, -118.2428)).rejects.toThrow("HTTP 503");
  });
});
