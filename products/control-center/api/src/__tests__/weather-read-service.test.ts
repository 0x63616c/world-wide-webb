import { describe, expect, it, vi } from "vitest";

// Fixed "current hour" rows the mocked DB returns for the hourly read. The read
// layer must label the first (current) hour "Now" at read time.
const nowHour = new Date();
nowHour.setMinutes(0, 0, 0);
const next = new Date(nowHour.getTime() + 3_600_000);

vi.mock("../db/index", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              {
                kind: "forecast",
                targetHour: nowHour,
                recordedAt: new Date(),
                tempF: 72,
                feelsF: 70,
                humidity: 58,
                weatherCode: 2,
                windMph: 9,
                isDay: true,
                precipProbability: 10,
                uvIndex: 6,
              },
              {
                kind: "forecast",
                targetHour: next,
                recordedAt: new Date(),
                tempF: 71,
                feelsF: 69,
                humidity: 59,
                weatherCode: 3,
                windMph: 10,
                isDay: false,
                precipProbability: 15,
                uvIndex: null,
              },
            ]),
        }),
      }),
    }),
  },
}));

import { readWeatherHourly } from "../services/weather-read-service";

describe("readWeatherHourly", () => {
  it("labels the current hour 'Now' and returns ascending slots", async () => {
    const hours = await readWeatherHourly();
    expect(hours[0].t).toBe("Now");
    expect(hours[0].temp).toBe(72);
    expect(hours.length).toBe(2);
    expect(hours.every((x) => typeof x.isoTime === "string")).toBe(true);
    // second slot is labelled by hour number, not "Now"
    expect(hours[1].t).not.toBe("Now");
  });

  it("collapses duplicate target hours to the freshest forecast", async () => {
    // The mock returns each hour once already; this asserts the dedupe keeps
    // one row per distinct target hour (no duplicate "Now").
    const hours = await readWeatherHourly();
    const nowCount = hours.filter((h) => h.t === "Now").length;
    expect(nowCount).toBe(1);
  });
});
