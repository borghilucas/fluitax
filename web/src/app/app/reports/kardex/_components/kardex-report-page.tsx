'use client';

import type { FormEvent, ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchJson, getApiBaseUrl } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { Button } from '@/ui/button';

export type KardexCompany = {
  id: string;
  name: string;
  cnpj: string | null;
};

export type KardexMovement = {
  type: string;
  timestamp: string | null;
  document: string | null;
  partner: string | null;
  partnerCnpj: string | null;
  cfop: string | null;
  qtySc: string;
  requestedQtySc: string;
  unitCostSc: string;
  movingAverageCost: string;
  balanceSc: string;
  balanceValue: string;
  notes: string | null;
  status: string;
  statusLabel: string;
  costRestart: boolean;
  costRestartLabel: string;
};

export type KardexFinishedSale = {
  timestamp: string | null;
  document: string | null;
  partner: string | null;
  partnerCnpj: string | null;
  productAlias: string;
  qtyUnits: string;
  unitPrice: string;
  mpConsumedSc: string;
  costAverageSc: string | null;
  mpCostValue: string | null;
  valuePerSc: string | null;
};

export type KardexTotals = {
  entriesSc: string;
  exitsSc: string;
  balanceSc: string;
  balanceValue: string;
  movingAverageCost: string;
};

export type KardexFinishedTotals = {
  qtyUnits: string;
  mpConsumedSc: string;
  revenuePerSc: string;
  mpCostValue: string;
};

export type KardexProductTotals = {
  productAlias: string;
  qtyUnits: string;
  mpConsumedSc: string;
  revenuePerSc: string;
  mpCostValue: string;
};

export type KardexReport = {
  filters: {
    from: string;
    to: string;
    companies: KardexCompany[];
  };
  mpMovements: KardexMovement[];
  finishedSales: KardexFinishedSale[];
  mpTotals: KardexTotals;
  finishedTotals: KardexFinishedTotals;
  finishedTotalsByProduct: KardexProductTotals[];
};

type KardexReportResponse = {
  report: KardexReport;
};

type Filters = {
  from: string;
  to: string;
};

type ReportState = {
  report: KardexReport | null;
  isLoading: boolean;
  error: string | null;
};

type KardexReportVariant = 'movement' | 'consumption';

type KardexReportPageProps = {
  activeTab: KardexReportVariant;
};

const tabs: Array<{ key: KardexReportVariant; label: string; href: string }> = [
  { key: 'movement', label: 'Movimentação da matéria-prima', href: '/app/reports/kardex/movimentacao' },
  { key: 'consumption', label: 'Consumo por produtos acabados', href: '/app/reports/kardex/consumo' },
];

export function KardexReportPage({ activeTab }: KardexReportPageProps) {
  const [filters, setFilters] = useState<Filters>({ from: '', to: '' });
  const [state, setState] = useState<ReportState>({ report: null, isLoading: false, error: null });
  const [exportError, setExportError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  const loadReport = useCallback(async (override?: Filters) => {
    const requestId = ++requestRef.current;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const currentFilters = override ?? filters;
    const params = new URLSearchParams();
    if (currentFilters.from.trim()) {
      params.append('from', currentFilters.from.trim());
    }
    if (currentFilters.to.trim()) {
      params.append('to', currentFilters.to.trim());
    }

    const queryString = params.toString();

    try {
      const response = await fetchJson<KardexReportResponse>(
        `/reports/kardex-consolidado${queryString ? `?${queryString}` : ''}`,
      );

      if (requestRef.current !== requestId) {
        return;
      }

      setState({
        report: response.report,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (requestRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Não foi possível carregar o relatório.';
      setState({ report: null, isLoading: false, error: message });
    }
  }, [filters]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadReport();
  }, [loadReport]);

  const handleChange = useCallback((key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleDownload = useCallback(async (format: 'csv' | 'pdf') => {
    setIsDownloading(true);
    setExportError(null);

    try {
      const params = new URLSearchParams();
      if (filters.from.trim()) {
        params.append('from', filters.from.trim());
      }
      if (filters.to.trim()) {
        params.append('to', filters.to.trim());
      }
      const queryString = params.toString();
      const baseUrl = getApiBaseUrl();
      const path = format === 'pdf'
        ? '/reports/kardex-consolidado.pdf'
        : '/reports/kardex-consolidado.csv';
      const url = `${baseUrl}${path}${queryString ? `?${queryString}` : ''}`;

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
        ? `kardex-consolidado-${timestamp}.pdf`
        : `kardex-consolidado-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao exportar o relatório.';
      setExportError(message);
    } finally {
      setIsDownloading(false);
    }
  }, [filters]);

  const apiBaseUrl = getApiBaseUrl();
  const jsonUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.from.trim()) {
      params.append('from', filters.from.trim());
    }
    if (filters.to.trim()) {
      params.append('to', filters.to.trim());
    }
    const queryString = params.toString();
    return `${apiBaseUrl}/reports/kardex-consolidado${queryString ? `?${queryString}` : ''}`;
  }, [apiBaseUrl, filters.from, filters.to]);

  const handlePrint = useCallback(() => {
    if (!printRef.current || state.isLoading) {
      return;
    }
    const title = activeTab === 'movement'
      ? 'Relatório Kardex — Movimentação da matéria-prima'
      : 'Relatório Kardex — Consumo por produtos acabados';
    const printWindow = window.open('', '_blank', 'width=1400,height=900');
    if (!printWindow) {
      return;
    }
    const headHtml = document.head.innerHTML;
    const sectionHtml = printRef.current.innerHTML;
    printWindow.document.write('<!DOCTYPE html><html><head>');
    printWindow.document.write(headHtml);
    printWindow.document.write('<style>body{padding:32px 48px;background:#fff;color:#0f172a;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;} h1{font-size:22px;margin-bottom:24px;} table{width:100%;border-collapse:collapse;} th,td{padding:8px 12px;} @media print {body{margin:0;padding:24px;}}</style>');
    printWindow.document.write(`</head><body><h1>${title}</h1>`);
    printWindow.document.write(sectionHtml);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 100);
  }, [activeTab, state.isLoading]);

  let content: ReactNode;
  if (state.isLoading) {
    content = (
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
        Carregando dados consolidados…
      </div>
    );
  } else if (state.error) {
    content = (
      <div className="rounded-2xl border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-4 py-6 text-sm text-[var(--color-feedback-danger)]">
        {state.error}
      </div>
    );
  } else if (!state.report) {
    content = (
      <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
        Informe um período e gere o relatório para visualizar as movimentações.
      </div>
    );
  } else {
    const report = state.report;
    const movementRows = report.mpMovements ?? [];
    const finishedRows = report.finishedSales ?? [];
    const sections = activeTab === 'movement'
      ? <MovementSection movementRows={movementRows} />
      : (
        <Fragment>
          <ConsumptionSection finishedRows={finishedRows} />
          <TotalsByProductSection products={report.finishedTotalsByProduct} />
        </Fragment>
      );

    content = (
      <div ref={printRef}>
        <ReportView report={report}>
          {sections}
        </ReportView>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[780px] space-y-2">
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Relatório Kardex consolidado (JM + OLG)</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Consolida entradas, saídas e custo médio da matéria-prima <strong>MP_CONILON</strong> com o consumo técnico das linhas
              de produto acabado, em sacas de 60 kg.
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]/80">
            Fonte dos dados
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-primary)]">
            Notas fiscais conciliadas no FluiTax a partir de 01/01/2025, excluindo CFOP 5905/5906, intercompany JM↔OLG e CNPJ 26.246.301/0001-93.
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2">
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Button
              key={tab.key}
              variant={isActive ? 'primary' : 'ghost'}
              size="sm"
              asChild
            >
              <Link href={tab.href} aria-current={isActive ? 'page' : undefined}>
                {tab.label}
              </Link>
            </Button>
          );
        })}
      </nav>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4 text-sm"
      >
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <label htmlFor="kardex-from" className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Período inicial
          </label>
          <input
            id="kardex-from"
            type="date"
            value={filters.from}
            onChange={(event) => handleChange('from', event.target.value)}
            className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
          />
        </div>
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <label htmlFor="kardex-to" className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Período final
          </label>
          <input
            id="kardex-to"
            type="date"
            value={filters.to}
            onChange={(event) => handleChange('to', event.target.value)}
            className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={state.isLoading || isDownloading} onClick={() => void handleDownload('csv')}>
            {isDownloading ? 'Gerando…' : 'Exportar CSV'}
          </Button>
          <Button type="button" variant="secondary" disabled={state.isLoading || isDownloading} onClick={() => void handleDownload('pdf')}>
            {isDownloading ? 'Gerando…' : 'Exportar PDF'}
          </Button>
          <Button type="button" variant="secondary" disabled={state.isLoading} onClick={handlePrint}>
            Imprimir
          </Button>
          <Button type="submit" disabled={state.isLoading}>
            {state.isLoading ? 'Carregando…' : 'Atualizar'}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]/80">Consulte via API</span>
          <code className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-2 py-1 font-mono text-[0.7rem] text-[var(--color-text-primary)]">
            GET {jsonUrl.replace(apiBaseUrl, '') || '/reports/kardex-consolidado'}
          </code>
        </div>
        <Button variant="ghost" size="sm" className="font-semibold text-[var(--color-brand-primary)] hover:underline" asChild>
          <a href={jsonUrl} target="_blank" rel="noreferrer">Abrir JSON</a>
        </Button>
      </div>

      {exportError ? (
        <div className="rounded-2xl border border-[var(--color-feedback-warning)]/60 bg-[var(--color-feedback-warning)]/10 px-4 py-3 text-sm text-[var(--color-feedback-warning)]">
          {exportError}
        </div>
      ) : null}

      {content}
    </div>
  );
}

function ReportView({ report, children }: { report: KardexReport; children: ReactNode }) {
  const companies = report.filters.companies.length
    ? report.filters.companies.map((company) => company.name).join(' + ')
    : '---';

  const fromLabel = report.filters.from ? formatDate(report.filters.from) : '--';
  const toLabel = report.filters.to ? formatDate(report.filters.to) : '--';

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Período contabilizado</p>
          <p className="mt-1 text-sm text-[var(--color-text-primary)]">
            {fromLabel} até {toLabel}
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            Empresas consolidadas: {companies}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Estoque final</p>
          <div className="mt-2 space-y-1 text-sm text-[var(--color-text-primary)]">
            <p>
              {formatNumber(report.mpTotals.balanceSc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SC ·{' '}
              {formatCurrency(report.mpTotals.balanceValue)}
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Custo médio móvel: {formatCurrency(report.mpTotals.movingAverageCost)}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        {[
          { label: 'Entradas de MP (SC)', value: report.mpTotals.entriesSc, fractionDigits: 2 },
          { label: 'Saídas de MP (SC)', value: report.mpTotals.exitsSc, fractionDigits: 2 },
          { label: 'Unidades vendidas', value: report.finishedTotals.qtyUnits, fractionDigits: 0 },
          { label: 'MP consumida (SC)', value: report.finishedTotals.mpConsumedSc, fractionDigits: 2 },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-5"
          >
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">
              {formatNumber(card.value, {
                minimumFractionDigits: card.fractionDigits,
                maximumFractionDigits: card.fractionDigits,
              })}
            </p>
          </div>
        ))}
      </section>

      {children}
    </div>
  );
}

export function MovementSection({ movementRows }: { movementRows: KardexMovement[] }) {
  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Movimentação da matéria-prima
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Todas as entradas, saídas e consumos técnicos ordenados cronologicamente.
          </p>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
          <thead className="bg-[var(--color-surface-root)] text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Data/Hora</th>
              <th className="px-3 py-2 font-semibold">Documento</th>
              <th className="px-3 py-2 font-semibold">Parceiro</th>
              <th className="px-3 py-2 font-semibold">CFOP</th>
              <th className="px-3 py-2 font-semibold">Tipo</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold text-right">Qtd (SC)</th>
              <th className="px-3 py-2 font-semibold text-right">Custo unit. (R$/SC)</th>
              <th className="px-3 py-2 font-semibold text-right">Custo médio (R$/SC)</th>
              <th className="px-3 py-2 font-semibold text-right">Saldo (SC)</th>
              <th className="px-3 py-2 font-semibold">Reinício custo</th>
              <th className="px-3 py-2 font-semibold">Observação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)] bg-white">
            {movementRows.map((movement, index) => {
              const isBlocked = movement.status === 'BLOCKED_ZERO_BALANCE';
              return (
                <tr
                  key={`${movement.timestamp}-${movement.document}-${index}`}
                  className={`hover:bg-[var(--color-gray-50)]/60 ${isBlocked ? 'bg-[var(--color-feedback-warning)]/10 text-[var(--color-text-primary)]' : ''}`}
                >
                  <td className="px-3 py-2 text-[var(--color-text-primary)]">{movement.timestamp ? formatDateTime(movement.timestamp) : '--'}</td>
                  <td className="px-3 py-2 font-mono text-[0.68rem] text-[var(--color-text-primary)]">{movement.document ?? '--'}</td>
                  <td className="px-3 py-2 text-[var(--color-text-primary)]">{movement.partner ?? movement.partnerCnpj ?? '--'}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{movement.cfop ?? '--'}</td>
                  <td className="px-3 py-2 text-[var(--color-text-primary)]">{movement.type.replaceAll('_', ' ')}</td>
                  <td className="px-3 py-2 text-[var(--color-text-primary)]">{movement.statusLabel}</td>
                  <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                    {formatNumber(movement.qtySc, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                    {formatCurrency(movement.unitCostSc)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                    {formatCurrency(movement.movingAverageCost)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                    {formatNumber(movement.balanceSc, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-primary)]">{movement.costRestartLabel}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{movement.notes ?? '--'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ConsumptionSection({ finishedRows }: { finishedRows: KardexFinishedSale[] }) {
  return (
    <section className="space-y-3">
      <header>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
          Consumo por produtos acabados
        </p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Cada venda gera consumo técnico de 1 SC para cada 9,6 unidades vendidas.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
          <thead className="bg-[var(--color-surface-root)] text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Data/Hora</th>
              <th className="px-3 py-2 font-semibold">Documento</th>
              <th className="px-3 py-2 font-semibold">Produto</th>
              <th className="px-3 py-2 font-semibold text-right">Qtd (unid)</th>
              <th className="px-3 py-2 font-semibold text-right">Preço unit. (R$)</th>
              <th className="px-3 py-2 font-semibold text-right">MP consumida (SC)</th>
              <th className="px-3 py-2 font-semibold text-right">Custo médio (R$/SC)</th>
              <th className="px-3 py-2 font-semibold text-right">Valor saca bruta (R$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)] bg-white">
            {finishedRows.map((sale, index) => (
              <tr key={`${sale.timestamp}-${sale.document}-${index}`} className="hover:bg-[var(--color-gray-50)]/60">
                <td className="px-3 py-2 text-[var(--color-text-primary)]">{sale.timestamp ? formatDateTime(sale.timestamp) : '--'}</td>
                <td className="px-3 py-2 font-mono text-[0.68rem] text-[var(--color-text-primary)]">{sale.document ?? '--'}</td>
                <td className="px-3 py-2 text-[var(--color-text-primary)]">{sale.productAlias}</td>
                <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                  {formatNumber(sale.qtyUnits, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(sale.unitPrice)}</td>
                <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                  {formatNumber(sale.mpConsumedSc, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </td>
                <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                  {sale.costAverageSc ? formatCurrency(sale.costAverageSc) : '--'}
                </td>
                <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                  {sale.valuePerSc ? formatCurrency(sale.valuePerSc) : '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TotalsByProductSection({ products }: { products: KardexProductTotals[] }) {
  return (
    <section className="space-y-3">
      <header>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
          Totais por produto acabado
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        {products.map((product) => (
          <div
            key={product.productAlias}
            className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4"
          >
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{product.productAlias}</p>
            <dl className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
              <div className="flex items-center justify-between">
                <dt>Unidades:</dt>
                <dd className="text-[var(--color-text-primary)]">
                  {formatNumber(product.qtyUnits, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>MP (SC):</dt>
                <dd className="text-[var(--color-text-primary)]">
                  {formatNumber(product.mpConsumedSc, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Receita estimada / SC:</dt>
                <dd className="text-[var(--color-text-primary)]">{formatCurrency(product.revenuePerSc)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>CMV estimado:</dt>
                <dd className="text-[var(--color-text-primary)]">{formatCurrency(product.mpCostValue)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
