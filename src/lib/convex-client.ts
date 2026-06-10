"use client";

import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { stateFromConvexSnapshot, stateSnapshotForConvex, type ConvexHouseholdSnapshot, type ConvexSnapshotPayload } from "./convex-adapter";
import type { AppState } from "./types";

interface SaveSnapshotResult {
  householdId: string;
  accounts: number;
  categories: number;
  transactions: number;
}

const saveSnapshot = makeFunctionReference<"mutation", ConvexSnapshotPayload, SaveSnapshotResult>("finance:saveSnapshot");
const getHouseholdSnapshot = makeFunctionReference<"query", { householdId: string }, ConvexHouseholdSnapshot>("finance:getHouseholdSnapshot");
const householdStorageKey = "rindomes.convex.householdId";

let client: ConvexReactClient | null = null;

export function isConvexConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
}

export async function saveStateSnapshotToConvex(state: AppState) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Falta NEXT_PUBLIC_CONVEX_URL para sincronizar con Convex.");
  }

  client ??= new ConvexReactClient(url);
  const existingHouseholdId = window.localStorage.getItem(householdStorageKey) ?? undefined;
  const payload = stateSnapshotForConvex(state, existingHouseholdId);
  const result = await client.mutation(saveSnapshot, payload);
  window.localStorage.setItem(householdStorageKey, result.householdId);

  return result;
}

export async function loadStateSnapshotFromConvex(fallbackState: AppState) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Falta NEXT_PUBLIC_CONVEX_URL para cargar desde Convex.");
  }

  const householdId = window.localStorage.getItem(householdStorageKey);
  if (!householdId) {
    throw new Error("No hay householdId local. Guarda en Convex una vez antes de cargar.");
  }

  client ??= new ConvexReactClient(url);
  const snapshot = await client.query(getHouseholdSnapshot, { householdId });
  return stateFromConvexSnapshot(snapshot, fallbackState);
}
