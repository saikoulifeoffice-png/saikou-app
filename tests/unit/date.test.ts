import { describe, expect, it } from "vitest";
import { jstDateString, jstRange, presetRange, addMonths } from "@/lib/date";

describe("JST 日付", () => {
  it("UTC 15:00 以降は JST の翌日", () => {
    expect(jstDateString(new Date("2026-11-12T15:00:00Z"))).toBe("2026-11-13");
    expect(jstDateString(new Date("2026-11-12T14:59:59Z"))).toBe("2026-11-12");
  });
  it("期間を [from,to) に変換", () => {
    expect(jstRange("2026-11-01", "2026-11-30")).toEqual({
      from: "2026-10-31T15:00:00.000Z",
      to: "2026-11-30T15:00:00.000Z",
    });
  });
  it("プリセット", () => {
    expect(presetRange("this_month", "2026-11-13")).toEqual({ from: "2026-11-01", to: "2026-11-13" });
    expect(presetRange("last_month", "2026-01-13")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("this_week", "2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" }); // 日曜
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
  });
});
