import { describe, expect, it } from "vitest";
import {
  DISCOUNT_TAG,
  RECEIPT_CREATED_BY,
  RECEIPT_TAG,
  emptyManualInput,
  receiptToInput,
  suggestionToInput,
} from "@/lib/capture-input";
import type { NaturalCaptureSuggestion } from "@/lib/natural-capture";
import type { ExchangeQuote } from "@/lib/currency";
import type { ReceiptAttachment } from "@/lib/types";
import { makeAccount, makeCategory, makeState } from "./fixtures";

const sameCurrencyQuote: ExchangeQuote = { rate: 1, date: "2026-06-06", source: "same_currency" };
const usdQuote: ExchangeQuote = { rate: 59.1, date: "2026-06-05", source: "api" };

function makeSuggestion(partial: Partial<NaturalCaptureSuggestion> = {}): NaturalCaptureSuggestion {
  return {
    type: "expense",
    amount: "750",
    currency: "DOP",
    categoryId: "health",
    subcategory: "Farmacia",
    accountId: "card",
    description: "Medicina",
    merchant: "Farmacia Carol",
    tags: "texto-natural",
    note: "Capturado por texto",
    confidence: 0.8,
    reasons: ["Monto detectado en el texto."],
    needsReview: false,
    ...partial,
  };
}

function makeReceipt(partial: Partial<ReceiptAttachment> = {}): ReceiptAttachment {
  return {
    id: partial.id ?? "rcpt-1",
    fileName: partial.fileName ?? "recibo-carol.jpg",
    contentType: partial.contentType ?? "image/jpeg",
    source: partial.source ?? "receipt",
    status: partial.status ?? "uploaded",
    createdAt: partial.createdAt ?? "2026-06-06",
    transactionId: partial.transactionId,
    amountCents: partial.amountCents,
    currency: partial.currency,
    date: partial.date,
    merchant: partial.merchant,
    extractedText: partial.extractedText,
    note: partial.note,
    storageId: partial.storageId,
  };
}

describe("suggestionToInput", () => {
  it("maps the suggestion fields onto the input and resolves exchange from the quote", () => {
    const s = makeSuggestion({ amount: "14.99", currency: "USD" });
    const input = suggestionToInput(s, { quote: usdQuote });

    expect(input.amount).toBe("14.99");
    expect(input.currency).toBe("USD");
    expect(input.categoryId).toBe("health");
    expect(input.accountId).toBe("card");
    // transferAccountId mirrors the source account (only used when type==='transfer').
    expect(input.transferAccountId).toBe("card");
    expect(input.exchangeRate).toBe(usdQuote.rate);
    expect(input.exchangeRateDate).toBe(usdQuote.date);
    expect(input.exchangeRateSource).toBe("api");
    expect(input.description).toBe("Medicina");
    expect(input.merchant).toBe("Farmacia Carol");
    expect(input.note).toBe("Capturado por texto");
    expect(input.needsReview).toBe(false);
  });

  it("defaults the date to today (YYYY-MM-DD) when not provided", () => {
    const input = suggestionToInput(makeSuggestion(), { quote: sameCurrencyQuote });
    expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("honors an explicit date override", () => {
    const input = suggestionToInput(makeSuggestion(), { quote: sameCurrencyQuote, date: "2026-05-01" });
    expect(input.date).toBe("2026-05-01");
  });

  it("threads attachmentRefs and derives attachmentNames from them", () => {
    const refs = [{ fileName: "recibo.jpg", storageId: "kg123", contentType: "image/jpeg" }];
    const input = suggestionToInput(makeSuggestion(), { quote: sameCurrencyQuote, attachmentRefs: refs });
    expect(input.attachmentRefs).toEqual(refs);
    expect(input.attachmentNames).toEqual(["recibo.jpg"]);
  });

  it("leaves attachmentRefs undefined when no files are passed", () => {
    const input = suggestionToInput(makeSuggestion(), { quote: sameCurrencyQuote });
    expect(input.attachmentRefs).toBeUndefined();
    expect(input.attachmentNames).toEqual([]);
  });

  it("de-duplicates merged extra tags", () => {
    const s = makeSuggestion({ tags: "texto-natural, recibo" });
    const input = suggestionToInput(s, { quote: sameCurrencyQuote, extraTags: ["recibo", "descuento"] });
    expect(input.tags).toBe("texto-natural, recibo, descuento");
  });
});

describe("receiptToInput — provenance preservation", () => {
  it("always marks the movement as needs_review (status 'needs_review')", () => {
    const input = receiptToInput(makeReceipt({ amountCents: 75000, currency: "DOP" }), makeSuggestion(), sameCurrencyQuote);
    expect(input.needsReview).toBe(true);
  });

  it("always includes the 'recibo' tag, first and de-duplicated", () => {
    const s = makeSuggestion({ tags: "texto-natural, recibo" });
    const input = receiptToInput(makeReceipt({ amountCents: 75000 }), s, sameCurrencyQuote);
    const tags = input.tags.split(",").map((t) => t.trim());
    expect(tags[0]).toBe(RECEIPT_TAG);
    expect(tags.filter((t) => t === RECEIPT_TAG)).toHaveLength(1);
    expect(tags).toContain("texto-natural");
  });

  it("preserves the receipt file as an attachmentRef carrying its storageId", () => {
    const receipt = makeReceipt({ amountCents: 75000, storageId: "kg_storage_42", contentType: "image/png", fileName: "ticket.png" });
    const input = receiptToInput(receipt, makeSuggestion(), sameCurrencyQuote);
    expect(input.attachmentNames).toEqual(["ticket.png"]);
    expect(input.attachmentRefs).toEqual([
      { fileName: "ticket.png", storageId: "kg_storage_42", contentType: "image/png" },
    ]);
  });

  it("exposes RECEIPT_CREATED_BY as the canonical 'Recibo' provenance constant", () => {
    // NewTransactionInput has no createdBy field; the constant documents the
    // intent the converged addTransaction / integrator stamps for receipt inputs.
    expect(RECEIPT_CREATED_BY).toBe("Recibo");
  });
});

describe("receiptToInput — transient folds", () => {
  it("folds a discount into the note and adds the 'descuento' tag", () => {
    const input = receiptToInput(
      makeReceipt({ amountCents: 75000 }),
      makeSuggestion({ note: "Compra en farmacia" }),
      sameCurrencyQuote,
      { discountText: "RD$50" },
    );
    expect(input.note).toContain("Compra en farmacia");
    expect(input.note).toContain("Descuento");
    expect(input.note).toContain("RD$50");
    expect(input.tags.split(",").map((t) => t.trim())).toContain(DISCOUNT_TAG);
  });

  it("does NOT add the 'descuento' tag when there is no discount", () => {
    const input = receiptToInput(makeReceipt({ amountCents: 75000 }), makeSuggestion(), sameCurrencyQuote);
    expect(input.tags.split(",").map((t) => t.trim())).not.toContain(DISCOUNT_TAG);
  });

  it("maps an explicit receiptDate onto Transaction.date", () => {
    const input = receiptToInput(
      makeReceipt({ amountCents: 75000 }),
      makeSuggestion(),
      sameCurrencyQuote,
      { receiptDate: "2026-04-15" },
    );
    expect(input.date).toBe("2026-04-15");
  });

  it("falls back to the receipt's own date when no transient receiptDate is given", () => {
    const input = receiptToInput(makeReceipt({ amountCents: 75000, date: "2026-03-10" }), makeSuggestion(), sameCurrencyQuote);
    expect(input.date).toBe("2026-03-10");
  });

  it("defaults the date to today when neither transient nor receipt date exist", () => {
    const input = receiptToInput(makeReceipt({ amountCents: 75000 }), makeSuggestion(), sameCurrencyQuote);
    expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("receiptToInput — value mapping", () => {
  it("derives the amount from the receipt's amountCents (receiptDate/amount mapping)", () => {
    const input = receiptToInput(makeReceipt({ amountCents: 123450, currency: "DOP" }), null, sameCurrencyQuote);
    expect(input.amount).toBe("1234.5");
    expect(input.currency).toBe("DOP");
  });

  it("falls back to the suggestion amount when the receipt has none", () => {
    const input = receiptToInput(makeReceipt(), makeSuggestion({ amount: "999" }), sameCurrencyQuote);
    expect(input.amount).toBe("999");
  });

  it("applies the quote's exchange fields", () => {
    const input = receiptToInput(makeReceipt({ amountCents: 1499, currency: "USD" }), makeSuggestion({ currency: "USD" }), usdQuote);
    expect(input.exchangeRate).toBe(usdQuote.rate);
    expect(input.exchangeRateSource).toBe("api");
    expect(input.currency).toBe("USD");
  });

  it("works with a null suggestion (no AI/heuristic available)", () => {
    const input = receiptToInput(makeReceipt({ amountCents: 50000, merchant: "Supermercado" }), null, sameCurrencyQuote);
    expect(input.type).toBe("expense");
    expect(input.merchant).toBe("Supermercado");
    expect(input.description).toBe("Recibo Supermercado");
    expect(input.tags.split(",").map((t) => t.trim())).toContain(RECEIPT_TAG);
    expect(input.needsReview).toBe(true);
  });
});

describe("emptyManualInput", () => {
  const state = makeState({
    currency: "DOP",
    accounts: [
      makeAccount({ id: "cash", name: "Efectivo", kind: "cash" }),
      makeAccount({ id: "card", name: "Tarjeta", kind: "credit", defaultForCapture: true }),
    ],
    categories: [
      makeCategory({ id: "salary", group: "income", name: "Salario", subcategories: ["Consultorio"] }),
      makeCategory({ id: "health", group: "essentials", name: "Salud", subcategories: ["Farmacia", "Medico"] }),
    ],
  });

  it("starts as a blank expense today in the household currency", () => {
    const input = emptyManualInput(state);
    expect(input.type).toBe("expense");
    expect(input.amount).toBe("");
    expect(input.currency).toBe("DOP");
    expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.needsReview).toBe(false);
    expect(input.attachmentNames).toEqual([]);
    expect(input.exchangeRate).toBe(1);
    expect(input.exchangeRateSource).toBe("same_currency");
  });

  it("selects the default-for-capture account", () => {
    expect(emptyManualInput(state).accountId).toBe("card");
  });

  it("selects the first non-income category and its first subcategory", () => {
    const input = emptyManualInput(state);
    expect(input.categoryId).toBe("health");
    expect(input.subcategory).toBe("Farmacia");
  });

  it("does not crash on an empty state (no accounts/categories)", () => {
    const bare = makeState({ accounts: [], categories: [] });
    const input = emptyManualInput(bare);
    expect(input.accountId).toBe("");
    expect(input.categoryId).toBe("");
    expect(input.subcategory).toBe("");
  });
});
