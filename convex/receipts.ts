import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertCanAccess } from "./finance";

// ============================================================================
// Real file storage for receipts/invoices. These functions own the
// `attachments` row authoritatively (it carries the _storage pointer), so the
// captured file pointer survives the next debounced saveSnapshot, which
// re-derives storageId via ctx.db.normalizeId. Without registerReceipt writing
// the row WITH storageId, the blob pointer would be lost on first autosave.
// ============================================================================

/**
 * Issues a short-lived upload URL the client POSTs the file bytes to. Convex
 * returns a storageId in the upload response, which the client then passes to
 * registerReceipt. Access is asserted so a stranger can't mint upload URLs
 * against someone else's household.
 */
export const generateReceiptUploadUrl = mutation({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    await assertCanAccess(ctx, householdId, userId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Authoritative insert of an attachments row that points at the uploaded blob.
 * status starts at 'uploaded' (not yet linked to a transaction). The returned
 * attachmentId is what the AI action and the link/delete mutations key on.
 */
export const registerReceipt = mutation({
  args: {
    householdId: v.id("households"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    source: v.union(
      v.literal("receipt"),
      v.literal("invoice"),
      v.literal("statement"),
      v.literal("other"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    await assertCanAccess(ctx, args.householdId, userId);
    return await ctx.db.insert("attachments", {
      householdId: args.householdId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      source: args.source,
      status: "uploaded",
      createdAt: Date.now(),
    });
  },
});

/**
 * Resolves the stored blob to a temporary download URL for previewing the
 * receipt in the review UI. Returns null if the attachment has no blob (e.g. a
 * legacy snapshot-only receipt with just a fileName).
 */
export const getReceiptUrl = query({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, { attachmentId }): Promise<string | null> => {
    const userId = await getAuthUserId(ctx);
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment) return null;
    await assertCanAccess(ctx, attachment.householdId, userId);
    if (!attachment.storageId) return null;
    return await ctx.storage.getUrl(attachment.storageId);
  },
});

/**
 * Links a confirmed receipt to the transaction created from it (after the user
 * approves the review) and flips status to 'confirmed'.
 */
export const linkReceiptToTransaction = mutation({
  args: {
    attachmentId: v.id("attachments"),
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, { attachmentId, transactionId }): Promise<{ ok: true }> => {
    const userId = await getAuthUserId(ctx);
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment) throw new Error("El recibo ya no existe.");
    await assertCanAccess(ctx, attachment.householdId, userId);

    // Validate the transaction belongs to the same household before linking.
    const transaction = await ctx.db.get(transactionId);
    if (!transaction || transaction.householdId !== attachment.householdId) {
      throw new Error("La transacción no pertenece a este hogar.");
    }

    await ctx.db.patch(attachmentId, {
      transactionId,
      status: "confirmed",
    });
    return { ok: true };
  },
});

/**
 * Deletes an attachment, freeing the _storage blob FIRST so the row deletion
 * can never leave an orphaned blob behind (closes the storage leak the plan
 * flagged). Idempotent: missing attachment is a no-op success.
 */
export const deleteAttachment = mutation({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, { attachmentId }): Promise<{ ok: true }> => {
    const userId = await getAuthUserId(ctx);
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment) return { ok: true };
    await assertCanAccess(ctx, attachment.householdId, userId);

    if (attachment.storageId) {
      // Free the blob before deleting the row. If the blob is already gone we
      // still proceed to delete the row.
      try {
        await ctx.storage.delete(attachment.storageId);
      } catch {
        // Blob already removed or never existed; the row delete below is the
        // authoritative cleanup.
      }
    }
    await ctx.db.delete(attachmentId);
    return { ok: true };
  },
});
