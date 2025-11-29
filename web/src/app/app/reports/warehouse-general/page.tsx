'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, getApiBaseUrl } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { Button } from '@/ui/button';
import { useCompanyContext } from '../../_context/company-context';

type WarehouseReportDetail = {
  invoiceId: string;
  invoiceChave: string | null;
  invoiceEmissao: string | null;
  natOp: string | null;
  quantity: string;
  unitPrice: string;
  totalValue: string;
};

type WarehouseReportGroup = {
  product: {
    productId: string | null;
    productName: string | null;
    productSku: string | null;
    productCode: string | null;
    productDescription: string | null;
    unit: string | null;
  };
  unitPrice: string;
  openingQty: string;
  openingValue: string;
  remessaQty: string;
  remessaValue: string;
  retornoQty: string;
  retornoValue: string;
  closingQty: string;
  closingValue: string;
  hasRemessa: boolean;
  hasRetorno: boolean;
  flags: {
    unmatchedReturnValue: boolean;
    returnWithoutRemessa: boolean;
    negativeBalance: boolean;
    valueDrift: boolean;
  };
  remessas: WarehouseReportDetail[];
  retornos: WarehouseReportDetail[];
};

type WarehouseReportMismatch = {
  type: 'UNIT_PRICE_MISMATCH' | 'RETURN_WITHOUT_REMESSA' | 'VALUE_DRIFT';
  message: string;
  product: WarehouseReportGroup['product'];
  unitPrice: string;
  quantity: string;
  totalValue: string;
  deltaValue?: string;
  invoice: {
    id: string;
    chave: string | null;
    emissao: string | null;
    natOp: string | null;
  } | null;
};

type WarehouseReportIssue = {
  type: string;
  message: string;
  invoice: {
    id: string | null;
    chave: string | null;
    emissao: string | null;
    natOp: string | null;
  } | null;
  cfop: string | null;
  product: {
    code: string | null;
    description: string | null;
    unit: string | null;
  };
  qty: string | null;
  unitPrice: string | null;
  gross: string | null;
};

type WarehouseReportPayload = {
  generatedAt: string;
  filters: {
    from: string | null;
    to: string | null;
    remessaCfop: string;
    retornoCfop: string;
  };
  totals: {
    openingQty: string;
    openingValue: string;
    remessaQty: string;
    remessaValue: string;
    retornoQty: string;
    retornoValue: string;
    closingQty: string;
    closingValue: string;
  };
  groups: WarehouseReportGroup[];
  mismatches: WarehouseReportMismatch[];
  issues: WarehouseReportIssue[];
};

type WarehouseReportResponse = {
  company: {
    id: string;
    name: string;
  };
  report: WarehouseReportPayload;
};

type Filters = {
  from: string;
  to: string;
};

export default function WarehouseGeneralReportPage() {
  const { selectedCompany, selectedCompanyId } = useCompanyContext();

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[760px] space-y-2">
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Controle de armazém geral</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Acompanhe remessas (CFOP 5905) e retornos (CFOP 5906) agrupados por produto e valor unitário, garantindo o saldo financeiro zero ao final do período.
            </p>
          </div>
          {selectedCompany ? (
            <div className="min-w-[260px] rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]/80">
                Empresa selecionada
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{selectedCompany.name}</p>
            </div>
          ) : null}
        </div>
      </header>

      <ReportFilters selectedCompanyId={selectedCompanyId} />
    </div>
  );
}

type ReportFiltersProps = {
  selectedCompanyId: string | null;
};

type ReportState = {
  report: WarehouseReportPayload | null;
  isLoading: boolean;
  error: string | null;
};

function ReportFilters({ selectedCompanyId }: ReportFiltersProps) {
  const [filters, setFilters] = useState<Filters>({ from: '', to: '' });
  const [state, setState] = useState<ReportState>({ report: null, isLoading: false, error: null });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const requestRef = useRef(0);
  const filtersRef = useRef<Filters>(filters);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const loadReport = useCallback(async (companyId: string, overrideFilters?: Filters) => {
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
      const response = await fetchJson<WarehouseReportResponse>(
        `/companies/${companyId}/reports/warehouse-general${queryString ? `?${queryString}` : ''}`,
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
    if (!selectedCompanyId) {
      setState({ report: null, isLoading: false, error: null });
      return;
    }

    void loadReport(selectedCompanyId);
  }, [loadReport, selectedCompanyId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId) {
      return;
    }
    void loadReport(selectedCompanyId, filters);
  };

  const handleChange = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    setExportError(null);
  }, [selectedCompanyId, filters.from, filters.to]);

  const handleExport = useCallback(async () => {
    if (!selectedCompanyId) {
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const params = new URLSearchParams();
      if (filtersRef.current.from.trim()) {
        params.append('from', filtersRef.current.from.trim());
      }
      if (filtersRef.current.to.trim()) {
        params.append('to', filtersRef.current.to.trim());
      }

      const baseUrl = getApiBaseUrl();
      const path = `/companies/${selectedCompanyId}/reports/warehouse-general.pdf`;
      const queryString = params.toString();
      const url = `${baseUrl}${path}${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Não foi possível exportar o PDF.');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `relatorio-armazem-${selectedCompanyId}-${timestamp}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível exportar o PDF.';
      setExportError(message);
    } finally {
      setIsExporting(false);
    }
  }, [selectedCompanyId]);

  const content = useMemo(() => {
    if (!selectedCompanyId) {
      return (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Selecione uma empresa para visualizar o relatório.
        </div>
      );
    }

    if (state.isLoading) {
      return (
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Carregando dados do relatório...
        </div>
      );
    }

    if (state.error) {
      return (
        <div className="rounded-2xl border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-4 py-6 text-sm text-[var(--color-feedback-danger)]">
          {state.error}
        </div>
      );
    }

    if (!state.report) {
      return (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Nenhum dado foi encontrado para o período informado.
        </div>
      );
    }

    return <ReportView report={state.report} />;
  }, [selectedCompanyId, state.error, state.isLoading, state.report]);

  return (
    <div className="space-y-6">
      <form
        className="grid gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4 text-sm [grid-template-columns:repeat(3,minmax(0,1fr))_auto]"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="warehouse-from" className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Período inicial
          </label>
          <input
            id="warehouse-from"
            type="date"
            value={filters.from}
            onChange={(event) => handleChange('from', event.target.value)}
            className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
            max={filters.to || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="warehouse-to" className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Período final
          </label>
          <input
            id="warehouse-to"
            type="date"
            value={filters.to}
            onChange={(event) => handleChange('to', event.target.value)}
            className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
            min={filters.from || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Atualizado em</span>
          <span className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-secondary)] shadow-sm">
            {state.report?.generatedAt ? formatDate(state.report.generatedAt) : '--'}
          </span>
        </div>
        <div className="flex items-end justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => void handleExport()}
            disabled={!selectedCompanyId || state.isLoading || isExporting}
          >
            {isExporting ? 'Gerando PDF…' : 'Exportar PDF'}
          </Button>
          <Button type="submit" disabled={!selectedCompanyId || state.isLoading}>
            Atualizar
          </Button>
        </div>
      </form>

      {exportError ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {exportError}
        </div>
      ) : null}

      {content}
    </div>
  );
}

type ReportViewProps = {
  report: WarehouseReportPayload;
};

function ReportView({ report }: ReportViewProps) {
  const { totals, mismatches, groups, issues } = report;

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-4 gap-4">
        <SummaryCard
          title="Saldo inicial - quantidade"
          value={formatNumber(totals.openingQty, { maximumFractionDigits: 4 })}
          subtitle="Remessas e retornos anteriores ao período"
        />
        <SummaryCard
          title="Saldo inicial - valor"
          value={formatCurrency(totals.openingValue)}
          subtitle="Financeiro acumulado antes do período"
        />
        <SummaryCard
          title="Qtd. remessas (período)"
          value={formatNumber(totals.remessaQty, { maximumFractionDigits: 4 })}
          subtitle="Somatório das quantidades remetidas"
        />
        <SummaryCard
          title="Valor remessas (período)"
          value={formatCurrency(totals.remessaValue)}
          subtitle="Total financeiro das remessas"
        />
        <SummaryCard
          title="Qtd. retornos (período)"
          value={formatNumber(totals.retornoQty, { maximumFractionDigits: 4 })}
          subtitle="Somatório das quantidades retornadas"
        />
        <SummaryCard
          title="Valor retornos (período)"
          value={formatCurrency(totals.retornoValue)}
          subtitle="Total financeiro dos retornos"
        />
        <SummaryCard
          title="Saldo final - quantidade"
          value={formatNumber(totals.closingQty, { maximumFractionDigits: 4 })}
          subtitle="Quantidade pendente após os retornos"
          emphasize={Number(totals.closingQty) !== 0}
        />
        <SummaryCard
          title="Saldo final - valor"
          value={formatCurrency(totals.closingValue)}
          subtitle="Financeiro pendente após os retornos"
          emphasize={Number(totals.closingValue) !== 0}
        />
      </section>

      {mismatches.length > 0 && (
        <section className="space-y-3">
          <header>
            <h2 className="text-base font-semibold text-red-700">Inconsistências encontradas</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Ajuste os retornos abaixo para que os valores unitários coincidam com as remessas registradas.
            </p>
          </header>
          <div className="space-y-3">
            {mismatches.map((item, index) => (
              <div
                key={`${item.product.productId ?? item.product.productCode ?? 'p'}-${item.unitPrice}-${item.type}-${index}`}
                className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {item.product.productName ?? item.product.productDescription ?? item.product.productCode ?? 'Produto não identificado'}
                  </p>
                  <span className="rounded-full bg-red-200 px-3 py-1 text-xs font-semibold uppercase text-red-800">
                    {item.type === 'UNIT_PRICE_MISMATCH'
                      ? 'Valor unitário divergente'
                      : item.type === 'RETURN_WITHOUT_REMESSA'
                        ? 'Retorno sem remessa'
                        : 'Saldo financeiro divergente'}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-4 gap-2 text-xs text-red-900">
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-red-700">Valor unitário do retorno</dt>
                    <dd>{formatCurrency(item.unitPrice)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-red-700">Quantidade retornada</dt>
                    <dd>{formatNumber(item.quantity, { maximumFractionDigits: 4 })}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-red-700">Valor total do retorno</dt>
                    <dd>{formatCurrency(item.totalValue)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-red-700">NF-e</dt>
                    <dd>{item.invoice?.chave ?? '--'}</dd>
                  </div>
                </dl>
                {item.type === 'UNIT_PRICE_MISMATCH' && (
                  <p className="mt-2 text-xs text-red-700">
                    Ajuste o valor do retorno para coincidir com o praticado nas remessas.
                  </p>
                )}
                {item.deltaValue && (
                  <p className="mt-2 text-xs text-red-700">
                    Diferença financeira identificada: {formatCurrency(item.deltaValue)}
                  </p>
                )}
                {item.message && <p className="mt-2 text-xs text-red-700">{item.message}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {issues.length > 0 && (
        <section className="space-y-3">
          <header>
            <h2 className="text-base font-semibold text-amber-700">Itens ignorados ou incompletos</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Ajuste os dados abaixo para que participem corretamente do controle de armazém.
            </p>
          </header>
          <div className="space-y-2">
            {issues.map((issue, index) => (
              <div
                key={`${issue.type}-${issue.invoice?.id ?? issue.cfop ?? index}`}
                className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800"
              >
                <p className="font-semibold uppercase tracking-[0.24em] text-amber-700">{issue.type.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-amber-900">{issue.message}</p>
                <dl className="mt-2 grid grid-cols-4 gap-2">
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-amber-700">NF-e</dt>
                    <dd>{issue.invoice?.chave ?? '--'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-amber-700">Emissão</dt>
                    <dd>{issue.invoice?.emissao ? formatDate(issue.invoice.emissao) : '--'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-amber-700">CFOP</dt>
                    <dd>{issue.cfop ?? '--'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.2em] text-amber-700">Qtd. / Valor unitário</dt>
                    <dd>
                      {issue.qty ?? '--'} / {issue.unitPrice ?? '--'}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Detalhamento por produto e valor unitário</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Cada grupo representa um lote com o mesmo produto e valor unitário. Utilize as colunas para acompanhar o saldo ainda pendente de retorno.
          </p>
        </header>

        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            Não encontramos remessas ou retornos dentro do período filtrado.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group, index) => (
              <div
                key={`${group.product.productId ?? group.product.productCode ?? 'p'}-${group.unitPrice}-${index}`}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] px-4 py-4">
                  <div className="space-y-1 text-sm">
                    <p className="text-base font-semibold text-[var(--color-text-primary)]">
                      {group.product.productName ?? group.product.productDescription ?? group.product.productCode ?? 'Produto não identificado'}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                      {group.product.productCode && <span>Código: {group.product.productCode}</span>}
                      {group.product.productSku && <span>SKU: {group.product.productSku}</span>}
                      {group.product.unit && <span>Unidade: {group.product.unit}</span>}
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)]/80">Valor unitário: {formatCurrency(group.unitPrice)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.flags.unmatchedReturnValue && (
                      <FlagPill tone="warning">Retorno com valor diferente</FlagPill>
                    )}
                    {group.flags.returnWithoutRemessa && (
                      <FlagPill tone="warning">Retorno sem remessa</FlagPill>
                    )}
                    {group.flags.negativeBalance && <FlagPill tone="danger">Saldo negativo</FlagPill>}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4 border-b border-[var(--color-border-subtle)] px-4 py-4 text-sm">
                  <Metric label="Abertura - quantidade" value={formatNumber(group.openingQty, { maximumFractionDigits: 4 })} />
                  <Metric label="Abertura - valor" value={formatCurrency(group.openingValue)} />
                  <Metric label="Remessas - quantidade" value={formatNumber(group.remessaQty, { maximumFractionDigits: 4 })} />
                  <Metric label="Remessas - valor" value={formatCurrency(group.remessaValue)} />
                  <Metric label="Retornos - quantidade" value={formatNumber(group.retornoQty, { maximumFractionDigits: 4 })} />
                  <Metric label="Retornos - valor" value={formatCurrency(group.retornoValue)} />
                  <Metric label="Saldo final - quantidade" value={formatNumber(group.closingQty, { maximumFractionDigits: 4 })} emphasize={group.flags.negativeBalance || Number(group.closingQty) !== 0} />
                  <Metric label="Saldo final - valor" value={formatCurrency(group.closingValue)} emphasize={group.flags.negativeBalance || group.flags.valueDrift || Number(group.closingValue) !== 0} />
                </div>

                <div className="grid grid-cols-2 gap-6 px-4 py-4">
                  <DetailTable title="Remessas" details={group.remessas} emptyMessage="Nenhuma remessa contabilizada" />
                  <DetailTable title="Retornos" details={group.retornos} emptyMessage="Nenhum retorno contabilizado" highlight={group.flags.unmatchedReturnValue || group.flags.returnWithoutRemessa} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type SummaryCardProps = {
  title: string;
  value: string;
  subtitle?: string;
  emphasize?: boolean;
};

function SummaryCard({ title, value, subtitle, emphasize = false }: SummaryCardProps) {
  const baseColor = emphasize ? 'text-white' : 'text-[var(--color-text-primary)]';
  const container = emphasize
    ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)] text-white shadow-md'
    : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-primary)]';
  const label = emphasize ? 'text-white/80' : 'text-[var(--color-text-secondary)]';
  const helper = emphasize ? 'text-white/70' : 'text-[var(--color-text-secondary)]/80';

  return (
    <div className={`rounded-2xl border px-4 py-4 ${container}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${label}`}>{title}</p>
      <p className={`mt-1 text-xl font-semibold ${baseColor}`}>{value}</p>
      {subtitle ? <p className={`mt-1 text-xs ${helper}`}>{subtitle}</p> : null}
    </div>
  );
}

type FlagPillProps = {
  children: string;
  tone: 'warning' | 'danger';
};

function FlagPill({ children, tone }: FlagPillProps) {
  const classes = tone === 'danger'
    ? 'bg-red-100 text-red-800 border-red-300'
    : 'bg-amber-100 text-amber-800 border-amber-300';

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase ${classes}`}>
      {children}
    </span>
  );
}

type MetricProps = {
  label: string;
  value: string;
  emphasize?: boolean;
};

function Metric({ label, value, emphasize = false }: MetricProps) {
  const labelColor = emphasize ? 'text-[var(--color-feedback-danger)]' : 'text-[var(--color-text-secondary)]';
  const valueColor = emphasize ? 'text-[var(--color-feedback-danger)]' : 'text-[var(--color-text-primary)]';

  return (
    <div className="space-y-1">
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${labelColor}`}>{label}</p>
      <p className={`text-base font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

type DetailTableProps = {
  title: string;
  details: WarehouseReportDetail[];
  emptyMessage: string;
  highlight?: boolean;
};

function DetailTable({ title, details, emptyMessage, highlight = false }: DetailTableProps) {
  const hasItems = details.length > 0;

  return (
    <div
      className={`rounded-2xl border p-4 text-xs ${
        highlight ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-secondary)]'
      }`}
    >
      <p className={`text-sm font-semibold ${highlight ? 'text-amber-800' : 'text-[var(--color-text-primary)]'}`}>{title}</p>
      {!hasItems ? (
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]/80">{emptyMessage}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--color-border-subtle)]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                <th className="px-2 py-2">NF-e</th>
                <th className="px-2 py-2">Emissão</th>
                <th className="px-2 py-2">Natureza</th>
                <th className="px-2 py-2 text-right">Qtd.</th>
                <th className="px-2 py-2 text-right">Vlr. unitário</th>
                <th className="px-2 py-2 text-right">Vlr. total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]/60">
              {details.map((detail, index) => (
                <tr key={`${detail.invoiceId}-${detail.invoiceChave ?? index}`}>
                  <td className="px-2 py-2 text-[11px] font-mono text-[var(--color-text-secondary)]">{detail.invoiceChave ?? '--'}</td>
                  <td className="px-2 py-2 text-[11px] text-[var(--color-text-secondary)]">
                    {detail.invoiceEmissao ? formatDate(detail.invoiceEmissao) : '--'}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-[var(--color-text-secondary)]">{detail.natOp ?? '--'}</td>
                  <td className="px-2 py-2 text-right text-[11px] text-[var(--color-text-primary)]">
                    {formatNumber(detail.quantity, { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-2 py-2 text-right text-[11px] text-[var(--color-text-primary)]">
                    {formatCurrency(detail.unitPrice)}
                  </td>
                  <td className="px-2 py-2 text-right text-[11px] text-[var(--color-text-primary)]">
                    {formatCurrency(detail.totalValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
