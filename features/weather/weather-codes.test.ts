import { describe, expect, it } from "vitest";
import { formatSolarEvent, nextSolarEvent, WEATHER_CODES, weatherIcon } from "./weather-codes";

// The request-path fetchWeather* functions were removed when weather moved to
// the ingest-into-Postgres model (see weather-ingest-service.test.ts and
// weather-read-service.test.ts). What remains in weather-service.ts are the pure
// helpers reused by both the ingest and read layers; this file pins them.

describe("weatherIcon", () => {
  it("maps clear codes to sun by day, moon by night", () => {
    expect(weatherIcon(0, 1)).toBe("sun");
    expect(weatherIcon(0, 0)).toBe("moon");
  });

  it("maps partly-cloudy code 2 to cloud-sun by day, cloud by night", () => {
    expect(weatherIcon(2, 1)).toBe("cloud-sun");
    expect(weatherIcon(2, 0)).toBe("cloud");
  });

  it("maps overcast/precip codes to cloud", () => {
    expect(weatherIcon(3, 1)).toBe("cloud");
    expect(weatherIcon(61, 1)).toBe("cloud");
  });
});

describe("formatSolarEvent", () => {
  it("formats an ISO local datetime as h:mm AM/PM", () => {
    expect(formatSolarEvent("2024-06-01T20:07")).toBe("8:07 PM");
    expect(formatSolarEvent("2024-06-01T05:14")).toBe("5:14 AM");
    expect(formatSolarEvent("2024-06-01T00:30")).toBe("12:30 AM");
    expect(formatSolarEvent("2024-06-01T12:00")).toBe("12:00 PM");
  });

  it("returns the input unchanged when it has no time component", () => {
    expect(formatSolarEvent("not-a-date")).toBe("not-a-date");
  });
});

describe("WEATHER_CODES", () => {
  it("covers the common conditions used by the dashboard", () => {
    expect(WEATHER_CODES[0]).toBe("Clear Sky");
    expect(WEATHER_CODES[2]).toBe("Partly Cloudy");
  });
});

describe("nextSolarEvent", () => {
  // Use explicit wall-clock dates so tests are deterministic regardless of when they run.
  const sunset = "2024-06-01T20:00";
  const tomorrowSunrise = "2024-06-02T06:01";

  it("returns Sunset when now is before sunset", () => {
    const now = new Date(2024, 5, 1, 14, 0); // 2pm local
    const result = nextSolarEvent(now, sunset, tomorrowSunrise);
    expect(result.label).toBe("Sunset");
    expect(result.value).toBe("8:00 PM");
  });

  it("returns Sunrise when now is after sunset but before tomorrow's sunrise", () => {
    const now = new Date(2024, 5, 1, 22, 0); // 10pm local (after 8pm sunset)
    const result = nextSolarEvent(now, sunset, tomorrowSunrise);
    expect(result.label).toBe("Sunrise");
    expect(result.value).toBe("6:01 AM");
  });

  it("returns Sunset when now is past tomorrow's sunrise (late morning next day)", () => {
    // Past tomorrow's sunrise , the day's next solar landmark is the current day's sunset.
    const now = new Date(2024, 5, 2, 10, 0); // 10am June 2
    const result = nextSolarEvent(now, sunset, tomorrowSunrise);
    expect(result.label).toBe("Sunset");
    expect(result.value).toBe("8:00 PM");
  });

  it("handles empty ISO strings without throwing", () => {
    const now = new Date(2024, 5, 1, 14, 0);
    const result = nextSolarEvent(now, "", "");
    // isoLocalToDate("") returns epoch; now is after epoch → falls to last branch.
    expect(result.label).toBe("Sunset");
  });
});
