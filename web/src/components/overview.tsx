"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Activity, Balances, Limits, Me, PaymentLink } from "@/lib/types";

export type Overview = {
  me: Me;
  balances: Balances;
  limits: Limits;
  activity: Activity[];
  links: PaymentLink[];
};

type Ctx = { data: Overview | null; error: string | null; refresh: () => Promise<void> };

const OverviewContext = createContext<Ctx>({ data: null, error: null, refresh: async () => {} });

export function OverviewProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await api<Overview>("/api/overview"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your wallet.");
    }
  }, []);
  useEffect(() => {
    // Initial load; setState happens after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  return <OverviewContext.Provider value={{ data, error, refresh }}>{children}</OverviewContext.Provider>;
}

export function useOverview() {
  return useContext(OverviewContext);
}
