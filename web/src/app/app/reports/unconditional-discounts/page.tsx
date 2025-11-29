'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, getApiBaseUrl } from '@/lib/api';
import { formatCnpj, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { useCompanyContext } from '../../_context/company-context';

type DiscountReportRow = {
  invoiceId: string;
  invoiceKey: string | null;
  issueDate: string | null;
  invoiceNumber: string | null;
  customerCnpj: string;
  customerName: string | null;
  totalValue: string;
  discountPercent: string;
  discountValue: string;
};

type DiscountReportPayload = {
  generatedAt: string;
  company: {
    id: string;
    name: string;
    cnpj: string | null;
    cnpjDigits: string | null;
  };
  profile: {
    alias: string;
    displayName: string;
  };
  filters: {
    from: string | null;
    to: string | null;
  };
  totals: {
    invoiceCount: number;
    customerCount: number;
    invoiceValue: string;
    discountValue: string;
  };
  rows: DiscountReportRow[];
};

type DiscountReportResponse = {
  report: DiscountReportPayload;
};

type Filters = {
  from: string;
  to: string;
};

type ReportState = {
  report: DiscountReportPayload | null;
  isLoading: boolean;
  error: string | null;
};

const EMPTY_FILTERS: Filters = { from: '', to: '' };

export default function UnconditionalDiscountReportPage() {
  const { selectedCompany, selectedCompanyId } = useCompanyContext();

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[760px] space-y-2">
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Descontos incondicionais</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Liste as notas fiscais de venda com descontos permanentes concedidos a clientes selecionados.
              Use este relatório como base para a contabilização trimestral da despesa dedutível.
            </p>
          </div>
          {selectedCompany ? (
            <div className="min-w-[260px] rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]/80">
                Empresa selecionada
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{selectedCompany.name}</p>
              <p className="font-mono text-xs text-[var(--color-text-secondary)]">
                CNPJ {formatCnpj(selectedCompany.cnpj)}
              </p>
            </div>
          ) : null}
        </div>
      </header>

      {selectedCompanyId ? (
        <ReportPanel companyId={selectedCompanyId} />
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-100)] px-6 py-8 text-sm text-[var(--color-text-secondary)]">
          Selecione uma empresa para visualizar os descontos incondicionais.
        </div>
      )}
    </div>
  );
}

type ReportPanelProps = {
  companyId: string;
};

function ReportPanel({ companyId }: ReportPanelProps) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [state, setState] = useState<ReportState>({ report: null, isLoading: true, error: null });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const requestRef = useRef(0);
  const filtersRef = useRef<Filters>(filters);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const loadReport = useCallback(
    async (targetCompanyId: string, overrideFilters?: Filters) => {
      const requestId = ++requestRef.current;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const currentFilters = overrideFilters ?? filtersRef.current;
      const params = new URLSearchParams();
      if (currentFilters.from.trim()) {
        params.append('from', currentFilters.from.trim());
      }
      if (currentFilters.to.trim()) {
        params.append('to', currentFilters.to.trim());
      }
      const queryString = params.toString();

      try {
        const response = await fetchJson<DiscountReportResponse>(
          `/companies/${targetCompanyId}/reports/unconditional-discounts${queryString ? `?${queryString}` : ''}`,
        );

        if (requestRef.current !== requestId) {
          return;
        }

        setState({ report: response.report, isLoading: false, error: null });
      } catch (error) {
        if (requestRef.current !== requestId) {
          return;
        }
        const message = error instanceof Error
          ? error.message
          : 'Não foi possível carregar o relatório.';
        setState({ report: null, isLoading: false, error: message });
      }
    },
    [],
  );

  useEffect(() => {
    const initial = { ...EMPTY_FILTERS };
    filtersRef.current = initial;
    setFilters(initial);
    requestRef.current = 0;
    void loadReport(companyId, initial);
  }, [companyId, loadReport]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadReport(companyId);
  }, [companyId, loadReport]);

  const handleFilterChange = useCallback((field: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleResetFilters = useCallback(() => {
    const reset = { ...EMPTY_FILTERS };
    filtersRef.current = reset;
    setFilters(reset);
    void loadReport(companyId, reset);
  }, [companyId, loadReport]);

  const handlePrint = useCallback(() => {
    if (!printRef.current || state.isLoading) {
      return;
    }

    const title = 'Relatório de descontos incondicionais';
    const printWindow = window.open('', '_blank', 'width=1400,height=900');
    if (!printWindow) {
      return;
    }

    const headHtml = document.head.innerHTML;
    const sectionHtml = printRef.current.innerHTML;

    printWindow.document.write('<!DOCTYPE html><html><head>');
    printWindow.document.write(headHtml);
    printWindow.document.write('<style>body{padding:32px 48px;background:#ffffff;color:#0f172a;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,\\\"Segoe UI\\\",sans-serif;} h1{font-size:22px;margin-bottom:24px;} table{width:100%;border-collapse:collapse;} th,td{padding:8px 12px;} @media print {body{margin:0;padding:24px;}}</style>');
    printWindow.document.write(`</head><body><h1>${title}</h1>`);
    printWindow.document.write(sectionHtml);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 100);
  }, [state.isLoading]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);

    const params = new URLSearchParams();
    if (filters.from.trim()) {
      params.append('from', filters.from.trim());
    }
    if (filters.to.trim()) {
      params.append('to', filters.to.trim());
    }
    const queryString = params.toString();
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/companies/${companyId}/reports/unconditional-discounts.csv${queryString ? `?${queryString}` : ''}`;

    try {
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
      link.download = `descontos-incondicionais-${timestamp}.csv`;
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
  }, [companyId, filters]);

  const periodLabel = useMemo(() => {
    if (!state.report?.filters) {
      return 'Todo o histórico disponível';
    }
    const from = state.report.filters.from ? formatDate(state.report.filters.from) : 'Início';
    const to = state.report.filters.to ? formatDate(state.report.filters.to) : 'Hoje';
    return `${from} a ${to}`;
  }, [state.report]);

  return (
    <section className="space-y-5">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[var(--color-border-subtle)] bg-white px-5 py-4 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              Data inicial
              <input
                type="date"
                value={filters.from}
                onChange={(event) => handleFilterChange('from', event.target.value)}
                className="mt-1 h-10 rounded-lg border border-[var(--color-border-subtle)] px-3 text-sm font-normal uppercase tracking-normal text-[var(--color-text-primary)] focus-visible:outline-focus-visible"
              />
            </label>
            <label className="flex flex-col text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              Data final
              <input
                type="date"
                value={filters.to}
                onChange={(event) => handleFilterChange('to', event.target.value)}
                className="mt-1 h-10 rounded-lg border border-[var(--color-border-subtle)] px-3 text-sm font-normal uppercase tracking-normal text-[var(--color-text-primary)] focus-visible:outline-focus-visible"
              />
            </label>
          </div>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <Button type="submit" disabled={state.isLoading}>
              {state.isLoading ? 'Carregando…' : 'Aplicar filtros'}
            </Button>
            <Button type="button" variant="secondary" onClick={handleResetFilters} disabled={state.isLoading}>
              Limpar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handlePrint}
              disabled={state.isLoading}
            >
              Imprimir relatório
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleExport}
              disabled={isExporting || state.isLoading}
            >
              {isExporting ? 'Exportando…' : 'Exportar CSV'}
            </Button>
          </div>
        </div>
      </form>

      {exportError ? (
        <div className="rounded-xl border border-[var(--color-feedback-danger)] bg-[var(--color-feedback-danger)]/10 px-4 py-3 text-sm text-[var(--color-feedback-danger)]">
          {exportError}
        </div>
      ) : null}

      {state.error ? (
        <div className="rounded-xl border border-[var(--color-feedback-danger)] bg-[var(--color-feedback-danger)]/10 px-4 py-3 text-sm text-[var(--color-feedback-danger)]">
          {state.error}
        </div>
      ) : null}

      <div ref={printRef} className="space-y-5">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Período</p>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">{periodLabel}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Atualizado em {formatDateTime(state.report?.generatedAt ?? new Date().toISOString())}
              </p>
            </div>
            {state.report?.profile?.displayName ? (
              <Badge variant="neutral" uppercase={false}>
                Perfil: {state.report.profile.displayName}
              </Badge>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Notas consideradas" value={formatNumber(state.report?.totals.invoiceCount ?? 0)} />
            <SummaryCard label="Clientes alcançados" value={formatNumber(state.report?.totals.customerCount ?? 0)} />
            <SummaryCard label="Total descontado" value={formatCurrency(state.report?.totals.discountValue ?? '0')} />
            <SummaryCard label="Valor das notas" value={formatCurrency(state.report?.totals.invoiceValue ?? '0')} />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-white shadow-sm">
          <div className="max-h-[540px] overflow-auto">
            <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-sm">
              <thead className="bg-[var(--color-gray-50)] text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Emissão</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Cliente</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">CNPJ</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.14em]">Nota fiscal</th>
                  <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.14em]">Valor nota</th>
                  <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.14em]">Percentual</th>
                  <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.14em]">Desconto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-faint)] text-[var(--color-text-primary)]">
                {state.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                      Carregando dados do relatório…
                    </td>
                  </tr>
                ) : state.report?.rows.length ? (
                  state.report.rows.map((row) => (
                    <tr key={row.invoiceId} className="hover:bg-[var(--color-gray-50)]/60">
                      <td className="px-4 py-3">{row.issueDate ? formatDate(row.issueDate) : '--'}</td>
                      <td className="px-4 py-3">{row.customerName ?? '--'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                        {formatCnpj(row.customerCnpj)}
                      </td>
                      <td className="px-4 py-3">{row.invoiceNumber ?? '--'}</td>
                      <td className="px-4 py-3 text-right font-medium text-[var(--color-text-primary)]">
                        {formatCurrency(row.totalValue)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--color-text-secondary)]">
                        {formatPercent(row.discountPercent, 2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[var(--color-brand-primary)]">
                        {formatCurrency(row.discountValue)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                      Nenhuma nota fiscal encontrada para o período selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
};

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white px-4 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
}
