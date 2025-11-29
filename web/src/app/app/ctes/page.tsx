'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { useCompanyContext } from '../_context/company-context';
import { Button } from '@/ui/button';

type Cte = {
  id: string;
  chave: string;
  numero: string | null;
  serie: string | null;
  emissao: string;
  cfop: string | null;
  emitNome: string | null;
  emitCnpj: string | null;
  destNome: string | null;
  destCnpj: string | null;
  destUf: string | null;
  destMun: string | null;
  valorPrestacao: string | null;
  pesoBruto: string | null;
};

type CteResponse = {
  items: Cte[];
  nextCursor?: string | null;
};

export default function CtePage() {
  const { selectedCompany, selectedCompanyId } = useCompanyContext();
  const [ctes, setCtes] = useState<Cte[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ search: string; from: string; to: string }>({
    search: '',
    from: '',
    to: '',
  });

  const loadCtes = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      if (!selectedCompanyId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('companyId', selectedCompanyId);
        if (filters.search.trim()) params.set('search', filters.search.trim());
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (opts?.cursor) params.set('cursor', opts.cursor);

        const response = await fetchJson<CteResponse>(`/ctes?${params.toString()}`);
        setNextCursor(response.nextCursor ?? null);
        setCtes((prev) => (opts?.append ? [...prev, ...response.items] : response.items));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha ao carregar CT-es.';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [filters.from, filters.search, filters.to, selectedCompanyId],
  );

  useEffect(() => {
    setCtes([]);
    setNextCursor(null);
    if (selectedCompanyId) {
      void loadCtes();
    }
  }, [loadCtes, selectedCompanyId]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void loadCtes();
  };

  const hasResults = useMemo(() => ctes.length > 0, [ctes.length]);

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Operação</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">CT-e</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Conhecimentos de transporte eletrônicos importados via XML.</p>
        {selectedCompany ? (
          <div className="text-xs text-[var(--color-text-secondary)]">
            <span className="font-semibold text-[var(--color-text-primary)]">{selectedCompany.name}</span>{' '}
            · CNPJ {selectedCompany.cnpj}
          </div>
        ) : null}
      </header>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 shadow-sm"
        onSubmit={handleSubmit}
      >
        <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Buscar</span>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Chave, número ou destinatário"
            className="h-9 w-56 rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Período início</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
            className="h-9 rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Período fim</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
            className="h-9 rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <Button type="submit" disabled={loading || !selectedCompanyId}>
            {loading ? 'Carregando…' : 'Aplicar filtros'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setFilters({ search: '', from: '', to: '' });
              void loadCtes({ append: false });
            }}
            disabled={loading}
          >
            Limpar
          </Button>
        </div>
      </form>

      {error ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm text-[var(--color-feedback-danger)]">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">CT-e importados</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {hasResults ? `${ctes.length} registro(s)` : 'Nenhum CT-e encontrado para os filtros.'}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-sm">
            <thead className="bg-[var(--color-gray-50)] text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Chave</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Número/Série</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Data</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Emitente</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Destinatário</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Destino</th>
                <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.14em]">Valor frete</th>
                <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.14em]">Peso bruto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-faint)] text-[var(--color-text-primary)]">
              {loading && !ctes.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                    Carregando CT-es…
                  </td>
                </tr>
              ) : ctes.length ? (
                ctes.map((cte) => (
                  <tr key={cte.id} className="hover:bg-[var(--color-gray-50)]/60">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)] break-all">{cte.chave}</td>
                    <td className="px-4 py-3">{cte.numero ? `CT ${cte.numero}${cte.serie ? ` · Série ${cte.serie}` : ''}` : '—'}</td>
                    <td className="px-4 py-3">{formatDate(cte.emissao)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{cte.emitNome || '—'}</div>
                      <div className="font-mono text-xs text-[var(--color-text-secondary)]">{cte.emitCnpj || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{cte.destNome || '—'}</div>
                      <div className="font-mono text-xs text-[var(--color-text-secondary)]">{cte.destCnpj || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                      {cte.destMun || '—'} {cte.destUf ? `· ${cte.destUf}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(cte.valorPrestacao || '0')}</td>
                    <td className="px-4 py-3 text-right">{cte.pesoBruto ? formatNumber(cte.pesoBruto) : '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                    Nenhum CT-e para exibir.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {nextCursor ? (
          <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3">
            <Button variant="secondary" onClick={() => loadCtes({ append: true, cursor: nextCursor })} disabled={loading}>
              {loading ? 'Carregando…' : 'Carregar mais'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
