'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '@/lib/api';

export type CompanySummary = {
  id: string;
  name: string;
  cnpj: string;
  createdAt: string;
  updatedAt: string;
};

type CompanyListResponse = {
  items: CompanySummary[];
};

type CompanyContextValue = {
  companies: CompanySummary[];
  isLoading: boolean;
  error: string | null;
  selectedCompanyId: string | null;
  selectedCompany: CompanySummary | null;
  selectCompany: (companyId: string | null) => void;
  refreshCompanies: () => Promise<void>;
  handleCompanyNotFound: (companyId?: string | null) => void;
};

const CompanyContext = createContext<CompanyContextValue | undefined>(undefined);

const STORAGE_KEY = 'fluitax:selected-company';

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const selectCompany = useCallback((companyId: string | null) => {
    setSelectedCompanyId(companyId);
    if (typeof window !== 'undefined') {
      if (companyId) {
        window.localStorage.setItem(STORAGE_KEY, companyId);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const refreshCompanies = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchJson<CompanyListResponse>('/companies');
      setCompanies(response.items ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível carregar as empresas.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSelectedCompanyId(stored);
      }
    }
    void refreshCompanies();
  }, [refreshCompanies]);

  useEffect(() => {
    if (companies.length === 0) {
      return;
    }
    if (!selectedCompanyId) {
      return;
    }
    const exists = companies.some((company) => company.id === selectedCompanyId);
    if (!exists) {
      const fallback = companies[0]?.id ?? null;
      selectCompany(fallback);
    }
  }, [companies, selectedCompanyId, selectCompany]);

  const selectedCompany = useMemo(() => {
    if (!selectedCompanyId) return null;
    return companies.find((company) => company.id === selectedCompanyId) ?? null;
  }, [companies, selectedCompanyId]);

  const handleCompanyNotFound = useCallback((companyId?: string | null) => {
    const target = companyId ?? selectedCompanyId;
    if (!target) return;
    selectCompany(null);
  }, [selectedCompanyId, selectCompany]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue === null) {
        setSelectedCompanyId(null);
      }
    };
    const onNotFound = () => setSelectedCompanyId(null);

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', onStorage);
      window.addEventListener('fluitax:company-not-found', onNotFound as EventListener);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('fluitax:company-not-found', onNotFound as EventListener);
      };
    }
    return undefined;
  }, []);

  const value = useMemo<CompanyContextValue>(() => ({
    companies,
    isLoading,
    error,
    selectedCompanyId,
    selectedCompany,
    selectCompany,
    refreshCompanies,
    handleCompanyNotFound,
  }), [companies, error, handleCompanyNotFound, isLoading, selectCompany, selectedCompany, selectedCompanyId, refreshCompanies]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompanyContext() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompanyContext deve ser usado dentro de CompanyProvider');
  }
  return context;
}
