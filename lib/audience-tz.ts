import type { Lead } from "@/db/schema";

export const AUDIENCE_TIMEZONE: Record<Lead["audience"], string> = {
  israeli_haredi: "Asia/Jerusalem",
  american_haredi: "America/New_York",
  european_haredi: "Europe/London",
};

export function localHourFor(audience: Lead["audience"], at: Date = new Date()) {
  const tz = AUDIENCE_TIMEZONE[audience];
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(at)
  );
  return hour;
}

export function isGoodTimeToCall(audience: Lead["audience"], at: Date = new Date()) {
  const hour = localHourFor(audience, at);
  return hour >= 9 && hour <= 21;
}

export function localTimeLabel(audience: Lead["audience"], at: Date = new Date()) {
  const tz = AUDIENCE_TIMEZONE[audience];
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}
