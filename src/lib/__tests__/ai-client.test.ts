import { describe, expect, it } from "vitest";
import { analyzeReceiptFile } from "@/lib/ai-client";
import type { AiCaptureResult } from "@/lib/entitlement";
import type { NaturalCaptureSuggestion } from "@/lib/natural-capture";
import { makeAccount, makeCategory, makeState } from "./fixtures";

// A minimal cloud suggestion, as convex/ai.ts would return inside the extraction.
function cloudSuggestion(partial: Partial<NaturalCaptureSuggestion> = {}): NaturalCaptureSuggestion {
  return {
    type: "expense",
    amount: "377.00",
    currency: "MXN",
    categoryId: "food",
    subcategory: "",
    accountId: "cash",
    description: "Compra · 11 productos",
    merchant: "Tiendas Tres B SA de CV",
    tags: "recibo",
    note: "",
    confidence: 0.9,
    reasons: [],
    needsReview: true,
    ...partial,
  };
}

// The local-heuristic fallback (failure / AI-off paths) needs at least one
// category and account to build a suggestion from.
const state = makeState({
  categories: [makeCategory({ id: "food", group: "essentials", name: "Comida" })],
  accounts: [makeAccount({ id: "cash", name: "Efectivo", defaultForCapture: true })],
});

describe("analyzeReceiptFile — forwards transient review signals", () => {
  // Regression: the success branch used to return ONLY { suggestion, isReceipt },
  // silently dropping items/receiptDate/discountText. That made the receipt
  // breakdown never reach the editable rows and the date fall back to "today".
  it("forwards items, receiptDate and discountText from the cloud extraction", async () => {
    const ok: AiCaptureResult = {
      ok: true,
      provider: "openrouter",
      usedModel: "qwen/qwen3-vl-30b-a3b-instruct",
      usedTier: "free",
      extraction: {
        suggestion: cloudSuggestion(),
        isReceipt: true,
        receiptDate: "2026-05-02",
        discountText: "MX$50",
        items: [
          { name: "Cree 3B", quantity: 1, amount: "30.00" },
          { name: "Leche entera 1L", quantity: 2, amount: "47.00" },
        ],
      },
    };

    const result = await analyzeReceiptFile({
      attachmentId: "att-1",
      householdId: "hh-1",
      state,
      aiEnabled: true,
      callParse: async () => ok,
    });

    expect(result.provider).toBe("openrouter");
    expect(result.suggestion.amount).toBe("377.00");
    expect(result.suggestion.currency).toBe("MXN");
    // The signals that used to be dropped:
    expect(result.receiptDate).toBe("2026-05-02");
    expect(result.discountText).toBe("MX$50");
    expect(result.items).toHaveLength(2);
    expect(result.items?.[0]).toEqual({ name: "Cree 3B", quantity: 1, amount: "30.00" });
  });

  it("falls back to the local heuristic with a reason+code on an authoritative failure", async () => {
    const fail: AiCaptureResult = { ok: false, code: "no_credits", error: "Sin créditos de IA." };

    const result = await analyzeReceiptFile({
      attachmentId: "att-1",
      householdId: "hh-1",
      state,
      aiEnabled: true,
      callParse: async () => fail,
    });

    expect(result.provider).toBe("local");
    expect(result.failCode).toBe("no_credits");
    expect(result.error).toContain("crédito");
    // No transient signals on the local path.
    expect(result.items).toBeUndefined();
    expect(result.receiptDate).toBeUndefined();
    expect(result.discountText).toBeUndefined();
  });

  it("skips the round-trip and uses the local heuristic when AI is off", async () => {
    let called = false;
    const result = await analyzeReceiptFile({
      attachmentId: "att-1",
      householdId: "hh-1",
      state,
      aiEnabled: false,
      callParse: async () => {
        called = true;
        return { ok: false, code: "ai_off", error: "off" };
      },
    });

    expect(called).toBe(false);
    expect(result.provider).toBe("local");
    expect(result.items).toBeUndefined();
  });
});
