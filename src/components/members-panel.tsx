"use client";

import { type FormEvent, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { roleLabel } from "@/lib/labels";
import { useT } from "@/lib/i18n";

const HOUSEHOLD_KEY = "rindomes.convex.householdId";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

/**
 * Real multiuser: invite family members by email and manage who can access the
 * hogar. An invite is claimed automatically when that email signs in. Only shown
 * to a signed-in user that already has a hogar in Convex.
 */
export function MembersPanel({ notify }: { notify?: Notify } = {}) {
  const { t } = useT();
  const { isAuthenticated } = useConvexAuth();
  const [householdId] = useState<string | null>(() =>
    typeof window !== "undefined" ? window.localStorage.getItem(HOUSEHOLD_KEY) : null,
  );
  const members = useQuery(
    api.finance.listMembers,
    isAuthenticated && householdId ? { householdId: householdId as Id<"households"> } : "skip",
  );
  const invite = useMutation(api.finance.inviteMember);
  const removeMember = useMutation(api.finance.removeMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [message, setMessage] = useState("");

  if (!isAuthenticated || !householdId) return null;

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await invite({ householdId: householdId as Id<"households">, email: email.trim(), role });
      setEmail("");
      const successMessage = t("Invitación enviada.", "Invitation sent.");
      setMessage(successMessage);
      notify?.(successMessage, "success");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t("No se pudo invitar.", "Couldn’t send the invitation.");
      setMessage(errorMessage);
      notify?.(errorMessage, "error");
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white/70 p-5">
      <p className="kicker text-[var(--primary)]">{t("Miembros del hogar", "Household members")}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{t("Invita a tu familia para que accedan juntos.", "Invite your family so you can manage finances together.")}</p>
      <form className="mt-4 space-y-3" onSubmit={handleInvite}>
        <div className="flex flex-col gap-2 md:flex-row">
          <input className="field min-w-0 flex-1 text-sm" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("email@familia.com", "email@family.com")} type="email" required />
          <button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black" type="submit">{t("Invitar", "Invite")}</button>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-[var(--text-muted)] hover:text-[var(--primary)]">
            {t("Permiso", "Permission")}: {roleLabel(role)}
          </summary>
          <select className="mt-2 w-full rounded-xl border border-[rgba(18,20,20,0.46)] bg-white px-3 py-2.5 text-sm hover:border-[rgba(18,20,20,0.56)] md:w-auto" value={role} onChange={(event) => setRole(event.target.value as "editor" | "viewer")} aria-label={t("Permiso del miembro", "Member permission")}>
            <option value="editor">{roleLabel("editor")}</option>
            <option value="viewer">{roleLabel("viewer")}</option>
          </select>
        </details>
      </form>
      {message && <p className="mt-2 text-sm text-[var(--text-muted)]">{message}</p>}
      <ul className="mt-4 space-y-2">
        {(members ?? []).map((member: { id: string; email: string; role: string; active: boolean }) => (
          <li className="flex items-center justify-between rounded-xl bg-white/60 px-4 py-2.5 text-sm" key={member.id}>
            <span>
              <span className="font-semibold">{member.email}</span>
              <span className="ml-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">{roleLabel(member.role)}{member.active ? "" : ` · ${t("pendiente", "pending")}`}</span>
            </span>
            {member.role !== "owner" && (
              <button className="text-xs font-bold text-[var(--danger)]" onClick={() => void removeMember({ memberId: member.id as Id<"householdMembers"> })} type="button">
                {t("Quitar", "Remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
