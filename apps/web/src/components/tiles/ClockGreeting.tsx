import { useEffect, useState } from "react";
import { ClockGreetingView } from "./ClockGreetingView";

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}

export function ClockGreeting() {
  const d = useNow();
  const rawHour = d.getHours();
  const ampm = rawHour >= 12 ? "PM" : "AM";
  const hour12 = rawHour % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const fullDate = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <ClockGreetingView
      greeting={greeting(rawHour)}
      hour12={hour12}
      minutes={minutes}
      ampm={ampm}
      fullDate={fullDate}
      location="Home"
      seconds={d.getSeconds()}
    />
  );
}
