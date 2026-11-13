/** 日付ユーティリティ（業務日付は Asia/Tokyo 基準） */
export const TZ = "Asia/Tokyo";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST の暦日 "YYYY-MM-DD" */
export function jstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の "YYYY-MM-DD" の 0:00 を UTC の Date で返す */
export function jstStartOfDay(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`日付形式が不正です: ${date}`);
  return new Date(Date.parse(`${date}T00:00:00+09:00`));
}

export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** 期間（JST の日付、両端含む）を [from, to) の ISO 文字列に変換 */
export function jstRange(fromDate: string, toDateInclusive: string): { from: string; to: string } {
  return {
    from: jstStartOfDay(fromDate).toISOString(),
    to: jstStartOfDay(addDays(toDateInclusive, 1)).toISOString(),
  };
}

export type PeriodPreset = "today" | "this_week" | "this_month" | "last_month" | "this_year" | "custom";

export function presetRange(preset: PeriodPreset, today = jstDateString()): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this_week": {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=日
      const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
      return { from: monday, to: today };
    }
    case "this_month":
      return { from: monthStart(today), to: today };
    case "last_month": {
      const start = addMonths(monthStart(today), -1);
      return { from: start, to: addDays(monthStart(today), -1) };
    }
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: monthStart(today), to: today };
  }
}

const dtf = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const df = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dtf.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "/");
  return df.format(typeof value === "string" ? new Date(value) : value);
}

/** <input type="datetime-local"> 用の JST 文字列 "YYYY-MM-DDTHH:mm" */
export function toJstLocalInput(d: Date = new Date()): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/** datetime-local（JST）→ ISO */
export function fromJstLocalInput(v: string): string {
  return new Date(Date.parse(`${v}:00+09:00`)).toISOString();
}
