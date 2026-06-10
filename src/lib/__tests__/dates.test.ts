import { describe, expect, it } from "vitest";
import { advanceRecurringDate, endOfMonth, nextMonthKey } from "@/lib/dates";

describe("endOfMonth", () => {
  it("returns the last calendar day of the month", () => {
    expect(endOfMonth("2026-05")).toBe("2026-05-31");
    expect(endOfMonth("2026-04")).toBe("2026-04-30");
  });

  it("handles February in common and leap years", () => {
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
    expect(endOfMonth("2024-02")).toBe("2024-02-29");
  });

  it("handles December", () => {
    expect(endOfMonth("2026-12")).toBe("2026-12-31");
  });
});

describe("nextMonthKey", () => {
  it("advances within the same year", () => {
    expect(nextMonthKey("2026-05")).toBe("2026-06");
  });

  it("rolls over the year boundary", () => {
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });
});

describe("advanceRecurringDate", () => {
  it("adds 7 days for weekly", () => {
    expect(advanceRecurringDate("2026-06-15", "weekly")).toBe("2026-06-22");
  });

  it("adds 14 days for biweekly", () => {
    expect(advanceRecurringDate("2026-06-15", "biweekly")).toBe("2026-06-29");
  });

  it("adds one month for monthly", () => {
    expect(advanceRecurringDate("2026-06-15", "monthly")).toBe("2026-07-15");
  });

  it("adds one year for yearly", () => {
    expect(advanceRecurringDate("2026-06-15", "yearly")).toBe("2027-06-15");
  });

  it("crosses the year boundary for a December monthly rule", () => {
    expect(advanceRecurringDate("2026-12-10", "monthly")).toBe("2027-01-10");
  });
});
