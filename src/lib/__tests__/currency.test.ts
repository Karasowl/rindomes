import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteExchangeRate } from "@/lib/currency";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quoteExchangeRate", () => {
  it("returns a 1:1 same-currency quote without hitting the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const quote = await quoteExchangeRate("DOP", "DOP");
    expect(quote.rate).toBe(1);
    expect(quote.source).toBe("same_currency");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the live API rate when the request succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          result: "success",
          rates: { DOP: 59.5 },
          time_last_update_utc: "Mon, 01 Jun 2026 00:00:00 +0000",
        }),
      })),
    );
    const quote = await quoteExchangeRate("USD", "DOP");
    expect(quote.rate).toBe(59.5);
    expect(quote.source).toBe("api");
  });

  it("falls back to an offline rate when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const quote = await quoteExchangeRate("USD", "DOP");
    expect(quote.source).toBe("manual");
    expect(quote.rate).toBeGreaterThan(0);
  });
});
