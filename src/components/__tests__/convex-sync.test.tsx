// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { createEmptyState } from "@/lib/onboarding";
import { I18nProvider } from "@/lib/i18n";
import type { AppState } from "@/lib/types";

// ----------------------------------------------------------------------------
// Mock de convex/react: cada test declara qué devuelve cada query (por nombre
// "finance:listMyHouseholds"…) y qué resuelven las mutaciones. Esto permite
// probar la POLÍTICA de resolución de hogar activo de ConvexSync — la pieza
// que arregló las invitaciones — sin backend.
// ----------------------------------------------------------------------------
const queryResults = new Map<string, unknown>();
const mutationMocks = new Map<string, ReturnType<typeof vi.fn>>();

function mutationMock(name: string) {
  if (!mutationMocks.has(name)) mutationMocks.set(name, vi.fn().mockResolvedValue(null));
  return mutationMocks.get(name)!;
}

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    return queryResults.get(getFunctionName(ref as never));
  },
  useMutation: (ref: unknown) => mutationMock(getFunctionName(ref as never)),
}));

import { ConvexSync } from "@/components/convex-sync";

const HOUSEHOLD_KEY = "rindomes.convex.householdId";

const FAM = { id: "hogar-familia", name: "Familia", role: "editor" as const, mode: "monthly-plan", currency: "DOP", memberCount: 2 };
const OWN = { id: "hogar-propio", name: "Propio", role: "owner" as const, mode: "tracker", currency: "DOP", memberCount: 1 };

function renderSync(overrides: Partial<Parameters<typeof ConvexSync>[0]> = {}) {
  const onHouseholdId = vi.fn();
  const onNeedsOnboarding = vi.fn();
  const onSwitchHandled = vi.fn();
  const utils = render(
    <I18nProvider>
      <ConvexSync
        state={createEmptyState() as AppState}
        setState={vi.fn()}
        ready
        canEdit={false}
        onHouseholdId={onHouseholdId}
        onNeedsOnboarding={onNeedsOnboarding}
        onSwitchHandled={onSwitchHandled}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onHouseholdId, onNeedsOnboarding, onSwitchHandled, ...utils };
}

beforeEach(() => {
  window.localStorage.clear();
  queryResults.clear();
  mutationMocks.clear();
});

afterEach(() => {
  cleanup();
});

describe("ConvexSync — resolución del hogar activo", () => {
  it("una invitación reclamada en este login cambia al hogar familiar aunque exista selección local", async () => {
    window.localStorage.setItem(HOUSEHOLD_KEY, OWN.id);
    queryResults.set("finance:listMyHouseholds", [OWN, FAM]);
    mutationMock("finance:claimInvites").mockResolvedValue(FAM.id);

    const { onHouseholdId } = renderSync();
    await waitFor(() => {
      expect(window.localStorage.getItem(HOUSEHOLD_KEY)).toBe(FAM.id);
    });
    expect(onHouseholdId).toHaveBeenLastCalledWith(FAM.id);
  });

  it("sin invitación nueva, la selección local válida se respeta (multi-espacio)", async () => {
    window.localStorage.setItem(HOUSEHOLD_KEY, FAM.id);
    queryResults.set("finance:listMyHouseholds", [OWN, FAM]);
    mutationMock("finance:claimInvites").mockResolvedValue(null);

    const { onHouseholdId } = renderSync();
    // claimInvites resuelve y la resolución corre: la selección debe seguir intacta.
    await waitFor(() => {
      expect(mutationMock("finance:claimInvites")).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(window.localStorage.getItem(HOUSEHOLD_KEY)).toBe(FAM.id);
    expect(onHouseholdId).toHaveBeenLastCalledWith(FAM.id);
  });

  it("una selección local que ya no es membresía cae a la primera membresía real", async () => {
    window.localStorage.setItem(HOUSEHOLD_KEY, "hogar-del-que-me-quitaron");
    queryResults.set("finance:listMyHouseholds", [OWN]);
    mutationMock("finance:claimInvites").mockResolvedValue(null);

    renderSync();
    await waitFor(() => {
      expect(window.localStorage.getItem(HOUSEHOLD_KEY)).toBe(OWN.id);
    });
  });

  it("sin membresías pero con hogar local legado, lo adopta vía claimHousehold", async () => {
    window.localStorage.setItem(HOUSEHOLD_KEY, "hogar-legado-anonimo");
    queryResults.set("finance:listMyHouseholds", []);
    mutationMock("finance:claimInvites").mockResolvedValue(null);
    mutationMock("finance:claimHousehold").mockResolvedValue({ claimed: true });

    renderSync();
    await waitFor(() => {
      expect(mutationMock("finance:claimHousehold")).toHaveBeenCalledWith({ householdId: "hogar-legado-anonimo" });
    });
  });

  it("el cambio de espacio pedido por la UI se aplica y se marca manejado", async () => {
    window.localStorage.setItem(HOUSEHOLD_KEY, OWN.id);
    queryResults.set("finance:listMyHouseholds", [OWN, FAM]);
    mutationMock("finance:claimInvites").mockResolvedValue(null);

    const { onSwitchHandled } = renderSync({ requestedHouseholdId: FAM.id });
    await waitFor(() => {
      expect(window.localStorage.getItem(HOUSEHOLD_KEY)).toBe(FAM.id);
      expect(onSwitchHandled).toHaveBeenCalled();
    });
  });

  it("abre onboarding solo cuando de verdad no hay hogar (membresías e invitaciones ya resueltas)", async () => {
    queryResults.set("finance:listMyHouseholds", []);
    mutationMock("finance:claimInvites").mockResolvedValue(null);

    const { onNeedsOnboarding } = renderSync();
    await waitFor(() => {
      expect(onNeedsOnboarding).toHaveBeenCalledTimes(1);
    });
  });

  it("NO abre onboarding mientras las invitaciones siguen sin reclamar (el invitado nuevo no debe ver setup)", async () => {
    queryResults.set("finance:listMyHouseholds", []);
    // claimInvites nunca resuelve dentro del test: simula la ventana de la carrera.
    mutationMock("finance:claimInvites").mockReturnValue(new Promise(() => {}));

    const { onNeedsOnboarding } = renderSync();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onNeedsOnboarding).not.toHaveBeenCalled();
  });
});
