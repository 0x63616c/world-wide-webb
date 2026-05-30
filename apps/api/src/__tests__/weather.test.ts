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
      temperature_2m_max: [80.1],
      temperature_2m_min: [60.5],
      sunset: ["2024-06-01T20:07"],
    },
  };
}

function makeHourlyResponse(startHour = 14) {
  // Build 48 hourly slots; current is at startHour
  const times: string[] = [];
  const temp: number[] = [];
  const feels: number[] = [];
  const code: number[] = [];
  const isDay: number[] = [];

  for (let i = 0; i < 48; i++) {
    const h = (startHour + i) % 24;
    const day = i < 24 ? "2024-06-01" : "2024-06-02";
    const hStr = String((startHour + i) % 24).padStart(2, "0");
    times.push(`${day}T${hStr}:00`);
    temp.push(72 + i * 0.1);
    feels.push(71 + i * 0.1);
    code.push(i < 12 ? 0 : 2);
    isDay.push(h >= 6 && h < 20 ? 1 : 0);
  }

  return {
    hourly: {
      time: times,
      temperature_2m: temp,
      apparent_temperature: feels,
      weather_code: code,
      is_day: isDay,
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
  const fakeNow = new Date("2024-06-01T14:30:00");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);
    vi.stubGlobal("fetch", mockFetchOk(makeHourlyResponse(14)));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns 12 items", async () => {
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

  it("night hours get moon or cloud icon (not sun)", async () => {
    // Hour 22 (10 PM) should be night icon
    vi.setSystemTime(new Date("2024-06-01T22:00:00"));
    vi.stubGlobal("fetch", mockFetchOk(makeHourlyResponse(22)));
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    // With weather_code 0 + is_day 0 → "moon"
    expect(result[0].ic).toBe("moon");
  });

  it("throws on fetch error", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    await expect(fetchWeatherHourly(34.0537, -118.2428)).rejects.toThrow();
  });

  it("calls Open-Meteo with hourly fields", async () => {
    await fetchWeatherHourly(34.0537, -118.2428);
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("hourly=temperature_2m");
    expect(url).toContain("apparent_temperature");
    expect(url).toContain("weather_code");
    expect(url).toContain("is_day");
  });
});

describe("icon mapping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("code 0 daytime → sun", async () => {
    const hourly = makeHourlyResponse(12);
    // is_day[0] = 1 (noon), code[0] = 0
    vi.stubGlobal("fetch", mockFetchOk(hourly));
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result[0].ic).toBe("sun");
  });

  it("code 3 (overcast) → cloud regardless of day", async () => {
    const hourly = makeHourlyResponse(12);
    hourly.hourly.weather_code = hourly.hourly.weather_code.map(() => 3);
    vi.stubGlobal("fetch", mockFetchOk(hourly));
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result[0].ic).toBe("cloud");
  });

  it("code 2 (partly cloudy) daytime → cloud-sun", async () => {
    const hourly = makeHourlyResponse(12);
    hourly.hourly.weather_code = hourly.hourly.weather_code.map(() => 2);
    vi.stubGlobal("fetch", mockFetchOk(hourly));
    const result = await fetchWeatherHourly(34.0537, -118.2428);
    expect(result[0].ic).toBe("cloud-sun");
  });
});
