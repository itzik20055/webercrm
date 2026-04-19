import { formatDistanceToNow, format, isToday, isTomorrow, isYesterday } from "date-fns";
import { he } from "date-fns/locale";

export function relativeTime(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true, locale: he });
}

export function smartDate(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return `היום ${format(d, "HH:mm")}`;
  if (isTomorrow(d)) return `מחר ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `אתמול ${format(d, "HH:mm")}`;
  return format(d, "d/M HH:mm", { locale: he });
}

export function shortDate(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "d/M", { locale: he });
}

export function fullDate(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "EEEE d בMMMM HH:mm", { locale: he });
}

export function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

export function whatsappLink(phone: string, text?: string) {
  const digits = digitsOnly(phone);
  const normalized = digits.startsWith("0") ? "972" + digits.slice(1) : digits;
  const base = `https://wa.me/${normalized}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function telLink(phone: string) {
  return `tel:${phone.replace(/\s/g, "")}`;
}
