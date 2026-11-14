import { jstRange, presetRange } from "@/lib/date";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** searchParams から期間（JST 日付・両端含む）を取得。既定は今月 */
export function readPeriod(sp: Record<string, string | string[] | undefined>) {
  const def = presetRange("this_month");
  const from = typeof sp.from === "string" && DATE_RE.test(sp.from) ? sp.from : def.from;
  let to = typeof sp.to === "string" && DATE_RE.test(sp.to) ? sp.to : def.to;
  if (to < from) to = from;
  const grain = typeof sp.grain === "string" && ["day", "week", "month", "year"].includes(sp.grain) ? sp.grain : "day";
  return { from, to, grain, ...{ range: jstRange(from, to) } };
}
