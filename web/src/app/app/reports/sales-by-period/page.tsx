'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, getApiBaseUrl } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { Button } from '@/ui/button';

type SalesProductRow = {
  productAlias: string;
  productLabel: string;
  quantityUnits: string;
  averageUnitPrice: string;
  pricePerSc: string;
  mpConsumedSc: string;
  averageMpCostSc: string;
};

type SalesReport = {
  filters: {
    from: string;
    to: string;
  };
  products: SalesProductRow[];
  totals: {
    quantityUnits: string;
    mpConsumedSc: string;
    averageMpCostSc: string;
  };
};

type SalesReportResponse = {
  report: SalesReport;
};

type Filters = {
  from: string;
  to: string;
};

type ReportState = {
  report: SalesReport | null;
  isLoading: boolean;
  error: string | null;
};

function buildDefaultFilters(): Filters {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromBase = new Date(today);
  fromBase.setDate(fromBase.getDate() - 30);
  const from = fromBase.toISOString().slice(0, 10);
  return { from, to };
}

export default function SalesByPeriodReportPage() {
  const [filters, setFilters] = useState<Filters>(() => buildDefaultFilters());
  const [state, setState] = useState<ReportState>({ report: null, isLoading: false, error: null });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const requestRef = useRef(0);
  const filtersRef = useRef<Filters>(filters);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const loadReport = useCallback(async (override?: Filters) => {
    const currentFilters = override ?? filtersRef.current;
    if (!currentFilters.from.trim() || !currentFilters.to.trim()) {
      setState({ report: null, isLoading: false, error: 'Informe as datas inicial e final.' });
      return;
    }

    const requestId = ++requestRef.current;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const params = new URLSearchParams();
    params.append('from', currentFilters.from.trim());
    params.append('to', currentFilters.to.trim());

    try {
      const response = await fetchJson<SalesReportResponse>(
        `/reports/vendas-por-periodo?${params.toString()}`,
      );

      if (requestRef.current !== requestId) {
        return;
      }

      setState({ report: response.report, isLoading: false, error: null });
    } catch (error) {
      if (requestRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Não foi possível carregar o relatório.';
      setState({ report: null, isLoading: false, error: message });
    }
  }, []);

  useEffect(() => {
    void loadReport(filtersRef.current);
  }, [loadReport]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadReport();
  }, [loadReport]);

  const handleFilterChange = useCallback((field: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleExport = useCallback(async (format: 'csv' | 'pdf') => {
    if (!filters.from.trim() || !filters.to.trim()) {
      setExportError('Informe as datas inicial e final antes de exportar.');
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const params = new URLSearchParams();
      params.append('from', filters.from.trim());
      params.append('to', filters.to.trim());

      const baseUrl = getApiBaseUrl();
      const path = format === 'pdf'
        ? '/reports/vendas-por-periodo.pdf'
        : '/reports/vendas-por-periodo.csv';
      const url = `${baseUrl}${path}?${params.toString()}`;

      const response = await fetch(url);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Falha ao exportar o relatório.');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = format === 'pdf'
        ? `vendas-por-periodo-${timestamp}.pdf`
        : `vendas-por-periodo-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao exportar o relatório.';
      setExportError(message);
    } finally {
      setIsExporting(false);
    }
  }, [filters]);

  const periodLabel = useMemo(() => {
    if (!state.report) return null;
    return `${formatDate(state.report.filters.from)} a ${formatDate(state.report.filters.to)}`;
  }, [state.report]);

  const content = useMemo(() => {
    if (state.isLoading) {
      return (
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Carregando vendas consolidadas…
        </div>
      );
    }

    if (state.error) {
      return (
        <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-feedback-warning)]/10 px-4 py-4 text-sm text-[var(--color-feedback-warning-strong)]">
          {state.error}
        </div>
      );
    }

    if (!state.report) {
      return (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Informe um período para visualizar as vendas consolidadas.
        </div>
      );
    }

    if (!state.report.products.length) {
      return (
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Não há vendas para os produtos selecionados no período informado.
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              Período
            </p>
            <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
              {periodLabel}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              Quantidade vendida (unid)
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {formatNumber(state.report.totals.quantityUnits, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              MP consumida (SC)
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {formatNumber(state.report.totals.mpConsumedSc, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              Custo médio global (R$/SC)
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {formatCurrency(state.report.totals.averageMpCostSc)}
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <header>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              Vendas consolidadas por produto
            </p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Considera apenas produtos acabados que consomem a matéria-prima CAFE CONILON BENEFICIADO.
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
              <thead className="bg-[var(--color-surface-root)] text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-3 py-2 font-semibold text-[var(--color-text-primary)]">Produto</th>
                  <th className="px-3 py-2 font-semibold text-right text-[var(--color-text-primary)]">Quantidade (unid)</th>
                  <th className="px-3 py-2 font-semibold text-right text-[var(--color-text-primary)]">Preço médio (R$/unid)</th>
                  <th className="px-3 py-2 font-semibold text-right text-[var(--color-text-primary)]">Preço por saca (R$/SC)</th>
                  <th className="px-3 py-2 font-semibold text-right text-[var(--color-text-primary)]">MP consumida (SC)</th>
                  <th className="px-3 py-2 font-semibold text-right text-[var(--color-text-primary)]">Custo médio MP (R$/SC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)] bg-white">
                {state.report.products.map((product) => (
                  <tr key={product.productAlias} className="hover:bg-[var(--color-gray-50)]/60">
                    <td className="px-3 py-2 text-[var(--color-text-primary)]">{product.productLabel}</td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {formatNumber(product.quantityUnits, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {formatCurrency(product.averageUnitPrice)}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {formatCurrency(product.pricePerSc)}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {formatNumber(product.mpConsumedSc, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {formatCurrency(product.averageMpCostSc)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[var(--color-surface-root)] text-[var(--color-text-primary)]">
                <tr>
                  <td className="px-3 py-2 font-semibold">Totais</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatNumber(state.report.totals.quantityUnits, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">--</td>
                  <td className="px-3 py-2 text-right font-semibold">--</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatNumber(state.report.totals.mpConsumedSc, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatCurrency(state.report.totals.averageMpCostSc)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    );
  }, [state, periodLabel]);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Vendas por período (JM + OLG)
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Relatório consolidado por produto acabado, considerando somente itens que consomem CAFE CONILON BENEFICIADO
          e respeitando todas as exclusões do Kardex (intercompany, CFOP 5905/5906 e parceiros bloqueados).
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
        <form className="flex flex-wrap items-end gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1">
            <label htmlFor="from" className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              Data inicial
            </label>
            <input
              id="from"
              type="date"
              value={filters.from}
              onChange={(event) => handleFilterChange('from', event.target.value)}
              className="h-10 rounded-xl border border-[var(--color-border-subtle)] px-3 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="to" className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              Data final
            </label>
            <input
              id="to"
              type="date"
              value={filters.to}
              onChange={(event) => handleFilterChange('to', event.target.value)}
              className="h-10 rounded-xl border border-[var(--color-border-subtle)] px-3 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/40"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary">
              Atualizar
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!state.report || isExporting}
              onClick={() => handleExport('csv')}
            >
              Exportar CSV
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!state.report || isExporting}
              onClick={() => handleExport('pdf')}
            >
              Exportar PDF
            </Button>
          </div>
        </form>
        {exportError ? (
          <p className="mt-3 text-xs text-[var(--color-feedback-warning-strong)]">
            {exportError}
          </p>
        ) : null}
      </section>

      {content}
    </div>
  );
}
