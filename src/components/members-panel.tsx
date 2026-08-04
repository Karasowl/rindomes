"use client";

import { type FormEvent, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { roleLabel } from "@/lib/labels";
import { useT } from "@/lib/i18n";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;
type MemberRole = "owner" | "editor" | "viewer";

interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
}

/**
 * Real multiuser: invita a tu familia por email y administra quién accede al
 * hogar. La invitación se vincula sola cuando ese email crea cuenta o inicia
 * sesión, y el hogar aparece en sus Espacios. El propietario puede cambiar
 * permisos (editor/solo lectura) y quitar miembros; el resto ve la lista.
 */
export function MembersPanel({
  householdId,
  myRole,
  notify,
}: {
  householdId: string | null;
  myRole: MemberRole | null;
  notify?: Notify;
}) {
  const { t } = useT();
  const { isAuthenticated } = useConvexAuth();
  const members = useQuery(
    api.finance.listMembers,
    isAuthenticated && householdId ? { householdId: householdId as Id<"households"> } : "skip",
  ) as MemberRow[] | undefined;
  const currentUser = useQuery(api.finance.currentUser, isAuthenticated ? {} : "skip") as
    | { email?: string }
    | null
    | undefined;
  const invite = useMutation(api.finance.inviteMember);
  const removeMember = useMutation(api.finance.removeMember);
  const updateMemberRole = useMutation(api.finance.updateMemberRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  if (!isAuthenticated || !householdId) return null;
  const isOwner = myRole === "owner";
  const myEmail = (currentUser?.email ?? "").toLowerCase();

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await invite({ householdId: householdId as Id<"households">, email: email.trim(), role });
      setEmail("");
      const successMessage = t(
        `Invitación creada. Pídele que cree su cuenta (o inicie sesión) con ${email.trim().toLowerCase()} y el hogar le aparecerá automáticamente.`,
        `Invitation created. Ask them to sign up (or sign in) with ${email.trim().toLowerCase()} and the household will appear for them automatically.`,
      );
      setMessageTone("success");
      setMessage(successMessage);
      notify?.(t("Invitación creada.", "Invitation created."), "success");
    } catch (error) {
      const errorMessage = error instanceof Error
        ? cleanConvexError(error.message)
        : t("No se pudo invitar.", "Couldn't send the invitation.");
      setMessageTone("error");
      setMessage(errorMessage);
      notify?.(errorMessage, "error");
    }
  }

  async function handleRoleChange(member: MemberRow, nextRole: "editor" | "viewer") {
    try {
      await updateMemberRole({ memberId: member.id as Id<"householdMembers">, role: nextRole });
      notify?.(
        t(`${member.email} ahora es ${roleLabel(nextRole).toLowerCase()}.`, `${member.email} is now ${roleLabel(nextRole).toLowerCase()}.`),
        "success",
      );
    } catch (error) {
      notify?.(
        error instanceof Error ? cleanConvexError(error.message) : t("No se pudo cambiar el permiso.", "Couldn't change the permission."),
        "error",
      );
    }
  }

  async function handleRemove(member: MemberRow) {
    if (typeof window !== "undefined" && !window.confirm(t(`¿Quitar a ${member.email} del hogar?`, `Remove ${member.email} from the household?`))) return;
    try {
      await removeMember({ memberId: member.id as Id<"householdMembers"> });
      notify?.(t(`${member.email} ya no tiene acceso.`, `${member.email} no longer has access.`), "success");
    } catch (error) {
      notify?.(
        error instanceof Error ? cleanConvexError(error.message) : t("No se pudo quitar al miembro.", "Couldn't remove the member."),
        "error",
      );
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white/70 p-5">
      <p className="kicker text-[var(--primary)]">{t("Miembros del hogar", "Household members")}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {isOwner
          ? t("Invita a tu familia para que accedan juntos a este hogar.", "Invite your family so you can manage this household together.")
          : t("Personas con acceso a este hogar. Solo el propietario administra miembros.", "People with access to this household. Only the owner manages members.")}
      </p>
      {isOwner && (
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
      )}
      {message && (
        <p className={`mt-2 text-sm ${messageTone === "error" ? "font-semibold text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{message}</p>
      )}
      <ul className="mt-4 space-y-2">
        {(members ?? []).map((member) => {
          const isSelf = member.email.toLowerCase() === myEmail;
          return (
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/60 px-4 py-2.5 text-sm" key={member.id}>
              <span className="min-w-0">
                <span className="font-semibold break-all">{member.email}</span>
                {isSelf && <span className="ml-2 text-xs font-bold text-[var(--primary)]">{t("tú", "you")}</span>}
                <span className="ml-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  {roleLabel(member.role)}
                  {member.active ? "" : ` · ${t("pendiente de entrar", "hasn't signed in yet")}`}
                </span>
              </span>
              {isOwner && member.role !== "owner" && (
                <span className="flex shrink-0 items-center gap-3">
                  <select
                    className="rounded-lg border border-[rgba(18,20,20,0.3)] bg-white px-2 py-1 text-xs"
                    value={member.role === "viewer" ? "viewer" : "editor"}
                    onChange={(event) => void handleRoleChange(member, event.target.value as "editor" | "viewer")}
                    aria-label={t(`Permiso de ${member.email}`, `Permission for ${member.email}`)}
                  >
                    <option value="editor">{roleLabel("editor")}</option>
                    <option value="viewer">{roleLabel("viewer")}</option>
                  </select>
                  <button className="text-xs font-bold text-[var(--danger)]" onClick={() => void handleRemove(member)} type="button">
                    {t("Quitar", "Remove")}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Convex antepone "[CONVEX M(...)] [Request ID: ...] Server Error / Uncaught Error:" a los
// mensajes de error de mutaciones; extrae solo el texto humano que escribimos en el backend.
function cleanConvexError(raw: string): string {
  const marker = "Uncaught Error:";
  const index = raw.indexOf(marker);
  const cut = index >= 0 ? raw.slice(index + marker.length) : raw;
  return cut.split("\n")[0].trim() || raw;
}
