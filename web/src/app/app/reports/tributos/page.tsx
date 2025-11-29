'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { Button } from '@/ui/button';

type MoneyPair = {
  unit: string;
  total: string;
};

type SalesLine = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  issueDate: string | null;
  cfop: string | null;
  productId: string | null;
  productName: string;
  productCode: string | null;
  ncm: string | null;
  quantity: string;
  unitValue: string;
  baseValueTotal: string;
  icmsBruto: MoneyPair;
  icmsDiscount: MoneyPair;
  icmsLiquido: MoneyPair;
  funcafe: MoneyPair;
  pisCofins: MoneyPair;
  st: MoneyPair | null;
  finalTax: MoneyPair;
  effectiveTaxRate: string;
};

type SalesTotals = {
  quantity: string;
  salesValue: string;
  icmsBruto: string;
  icmsDiscount: string;
  icmsLiquido: string;
  funcafe: string;
  pisCofins: string;
  finalTax: string;
  st?: string;
};

type SalesProductSummary = {
  productId: string | null;
  productName: string;
  ncm: string | null;
  totalQuantity: string;
  totalSalesValue: string;
  totalFinalTax: string;
  icmsBruto: string;
  icmsDiscount: string;
  icmsLiquido: string;
  funcafe: string;
  pisCofins: string;
  st: string | null;
  averageUnitPrice: string;
  taxPerUnit: string;
  effectiveTaxRate: string;
};

type NcmRankingRow = {
  ncm: string | null;
  totalQuantity: string;
  totalSalesValue: string;
  totalFinalTax: string;
  effectiveTaxRate: string;
};

type SalesSection = {
  lines: SalesLine[];
  totals: SalesTotals;
  productSummary: SalesProductSummary[];
  ncmRanking: NcmRankingRow[];
};

type FunruralLine = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  issueDate: string | null;
  cfop: string | null;
  productId: string | null;
  productName: string;
  productCode: string | null;
  ncm: string | null;
  quantity: string;
  unitValue: string;
  baseValueTotal: string;
  funrural: MoneyPair;
  effectiveTaxRate: string;
};

type FunruralTotals = {
  quantity: string;
  purchaseValue: string;
  funrural: string;
};

type FunruralProductSummary = {
  productId: string | null;
  productName: string;
  ncm: string | null;
  totalQuantity: string;
  totalPurchaseValue: string;
  totalFunrural: string;
  averageUnitPrice: string;
  taxPerUnit: string;
  effectiveTaxRate: string;
};

type FunruralSection = {
  lines: FunruralLine[];
  totals: FunruralTotals;
  productSummary: FunruralProductSummary[];
};

type TributosReport = {
  generatedAt: string;
  company: {
    id: string;
    name: string;
    cnpj: string;
  };
  filters: {
    from: string | null;
    to: string | null;
  };
  tributo1: SalesSection;
  tributo2: SalesSection;
  tributo3: FunruralSection;
  overall: {
    totalSalesTax: string;
    totalFunrural: string;
    totalDiscountIcms: string;
    grandTotalTax: string;
  };
};

type Filters = {
  from: string;
  to: string;
};

type ReportState = {
  report: TributosReport | null;
  isLoading: boolean;
  error: string | null;
};

export default function TributosReportPage() {
  const [filters, setFilters] = useState<Filters>({ from: '', to: '' });
  const [state, setState] = useState<ReportState>({ report: null, isLoading: false, error: null });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadReport = useCallback(async (override?: Filters) => {
    const requestId = ++requestRef.current;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const current = override ?? filters;
    const params = new URLSearchParams();
    if (current.from.trim()) {
      params.append('from', current.from.trim());
    }
    if (current.to.trim()) {
      params.append('to', current.to.trim());
    }

    const query = params.toString();
    try {
      const response = await fetchJson<{ report: TributosReport }>(
        `/reports/tributos-olg${query ? `?${query}` : ''}`,
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
  }, [filters]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadReport();
  }, [loadReport]);

  const handleReset = useCallback(() => {
    setFilters({ from: '', to: '' });
    setExportError(null);
    void loadReport({ from: '', to: '' });
  }, [loadReport]);

  const handleExportCsv = useCallback(async () => {
    if (state.isLoading || isExporting) {
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const params = new URLSearchParams();
      if (filters.from.trim()) {
        params.append('from', filters.from.trim());
      }
      if (filters.to.trim()) {
        params.append('to', filters.to.trim());
      }
      const query = params.toString();
      const response = await fetch(`/reports/tributos-olg.csv${query ? `?${query}` : ''}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Falha ao exportar CSV.');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition');
      let filename = 'tributos-olg.csv';
      if (disposition) {
        const match = /filename="([^"]+)"/.exec(disposition);
        if (match?.[1]) {
          filename = match[1];
        }
      }
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao exportar CSV.';
      setExportError(message);
    } finally {
      setIsExporting(false);
    }
  }, [filters.from, filters.to, isExporting, state.isLoading]);

  const handlePrint = useCallback(() => {
    if (state.isLoading || !state.report) {
      return;
    }
    if (typeof window !== 'undefined') {
      window.print();
    }
  }, [state.isLoading, state.report]);

  let content: JSX.Element | null = null;
  if (state.isLoading) {
    content = (
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6">
        <LoadingState message="Carregando dados tributários…" />
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
        Informe um período (opcional) e gere o relatório para visualizar os tributos.
      </div>
    );
  } else {
    content = <ReportView report={state.report} />;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Relatório de Tributos — OLG Indústria e Comércio</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Consolida ICMS, FUNCAFÉ, PIS/COFINS, ST e FUNRURAL conforme premissas fornecidas. Utilize para acompanhar benefícios fiscais,
            carga tributária efetiva e valores devidos.
          </p>
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4 text-sm"
      >
        <div className="flex min-w-[220px] flex-col gap-1">
          <label htmlFor="tributos-from" className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Período inicial
          </label>
          <input
            id="tributos-from"
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
          />
        </div>
        <div className="flex min-w-[220px] flex-col gap-1">
          <label htmlFor="tributos-to" className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Período final
          </label>
          <input
            id="tributos-to"
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handlePrint}
            disabled={state.isLoading || !state.report || isExporting}
          >
            Imprimir
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void handleExportCsv();
            }}
            disabled={state.isLoading || isExporting}
          >
            {isExporting ? 'Gerando…' : 'Exportar CSV'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleReset} disabled={state.isLoading || isExporting}>
            Limpar filtro
          </Button>
          <Button type="submit" disabled={state.isLoading || isExporting}>
            {state.isLoading ? 'Carregando…' : 'Atualizar'}
          </Button>
        </div>
      </form>

      {exportError ? (
        <div className="rounded-2xl border border-[var(--color-feedback-warning)]/60 bg-[var(--color-feedback-warning)]/10 px-4 py-3 text-sm text-[var(--color-feedback-warning)]">
          {exportError}
        </div>
      ) : null}

      {content}
    </div>
  );
}

function ReportView({ report }: { report: TributosReport }) {
  const fromLabel = report.filters.from ? formatDate(report.filters.from) : '---';
  const toLabel = report.filters.to ? formatDate(report.filters.to) : '---';

  const overallCards = useMemo(() => {
    const salesTax = Number(report.overall.totalSalesTax);
    const funrural = Number(report.overall.totalFunrural);
    const discount = Number(report.overall.totalDiscountIcms);
    return [
      {
        label: 'Tributos sobre vendas',
        value: formatCurrency(salesTax),
        hint: 'ICMS líquido + FUNCAFÉ + PIS/COFINS + ST',
        variant: 'highlight' as const,
      },
      {
        label: 'Desconto de ICMS aplicado',
        value: formatCurrency(discount),
        hint: 'Base para FUNCAFÉ e PIS/COFINS',
        variant: 'accent' as const,
      },
      {
        label: 'FUNRURAL (compras)',
        value: formatCurrency(funrural),
        hint: 'Produtores rurais pessoa física — CFOP 1.101',
      },
      {
        label: 'Total geral de tributos',
        value: formatCurrency(Number(report.overall.grandTotalTax)),
        hint: 'Vendas + FUNRURAL',
        variant: 'highlight' as const,
      },
    ];
  }, [report.overall]);

  const tributo1Ref = useRef<HTMLDivElement>(null);
  const tributo2Ref = useRef<HTMLDivElement>(null);
  const tributo3Ref = useRef<HTMLDivElement>(null);

  const handleSectionPrint = useCallback((ref: React.RefObject<HTMLDivElement>, title: string) => {
    if (!ref.current) return;
    const printWindow = window.open('', '_blank', 'width=1400,height=900');
    if (!printWindow) return;

    const headContent = document.head.innerHTML;
    const sectionHtml = ref.current.innerHTML;

    printWindow.document.write('<!DOCTYPE html><html><head>');
    printWindow.document.write(headContent);
    printWindow.document.write('<style>body{padding:32px 48px;background:#ffffff;color:#0f172a;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;} h1{font-size:22px;margin-bottom:24px;} table{border-collapse:collapse;width:100%;} table th,table td{padding:8px 12px;} @media print {body{margin:0;padding:24px;}}</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(`<h1>${title}</h1>`);
    printWindow.document.write(sectionHtml);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 100);
  }, []);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Empresa</p>
          <p className="mt-1 text-sm text-[var(--color-text-primary)]">
            {report.company.name}
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            CNPJ {report.company.cnpj}
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Período contabilizado</p>
          <p className="mt-1 text-sm text-[var(--color-text-primary)]">
            {fromLabel} até {toLabel}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Resumo geral</p>
          <div className="mt-3 grid gap-3">
            {overallCards.map((card) => (
              <SummaryItem key={card.label} label={card.label} value={card.value} hint={card.hint} variant={card.variant} />
            ))}
          </div>
        </div>
      </section>

      <div ref={tributo1Ref}>
        <SalesSectionView
          title="Tributo 1 — Venda de Café Torrado em Rondônia"
          subtitle="CFOP 5.401 — Aplicação das alíquotas com ST"
          section={report.tributo1}
          includeSt
          onPrintSection={() => handleSectionPrint(tributo1Ref, 'Tributo 1 — Venda de Café Torrado em Rondônia')}
        />
      </div>

      <div ref={tributo2Ref}>
        <SalesSectionView
          title="Tributo 2 — Venda de Café Torrado para fora de Rondônia"
          subtitle="CFOP 6.101 — Benefício fiscal sem ST"
          section={report.tributo2}
          includeSt={false}
          onPrintSection={() => handleSectionPrint(tributo2Ref, 'Tributo 2 — Venda de Café Torrado para fora de Rondônia')}
        />
      </div>

      <div ref={tributo3Ref}>
        <FunruralSectionView
          section={report.tributo3}
          onPrintSection={() => handleSectionPrint(tributo3Ref, 'Tributo 3 — FUNRURAL na compra de café cru')}
        />
      </div>
    </div>
  );
}

function SalesSectionView({
  title,
  subtitle,
  section,
  includeSt,
  onPrintSection,
}: {
  title: string;
  subtitle: string;
  section: SalesSection;
  includeSt: boolean;
  onPrintSection: () => void;
}) {
  const totalQuantity = Number(section.totals.quantity);
  const totalSalesValue = Number(section.totals.salesValue);
  const totalFinalTax = Number(section.totals.finalTax);
  const totalDiscount = Number(section.totals.icmsDiscount);
  const effectiveRate = totalSalesValue > 0 ? (totalFinalTax / totalSalesValue) * 100 : 0;
  const ticketMedio = totalQuantity > 0 ? totalSalesValue / totalQuantity : 0;
  const hasLines = section.lines.length > 0;
  const hasProductSummary = section.productSummary.length > 0;
  const hasNcmRanking = section.ncmRanking.length > 0;

  return (
    <section className="space-y-5 rounded-2xl border border-[var(--color-border-subtle)] bg-white p-6 shadow-sm">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">{subtitle}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onPrintSection}>
            Imprimir tributo
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Unidades vendidas" value={formatNumber(totalQuantity, { maximumFractionDigits: 4 })} hint="Somatório das quantidades (fardos/unidades)" />
          <SummaryItem label="Valor vendido" value={formatCurrency(totalSalesValue)} hint="Base de cálculo (valor do produto)" />
          <SummaryItem label="Imposto total" value={formatCurrency(totalFinalTax)} hint="ICMS líquido + FUNCAFÉ + PIS/COFINS + ST" />
          <SummaryItem label="Carga tributária efetiva" value={`${formatNumber(effectiveRate, { maximumFractionDigits: 2 })}%`} hint="Imposto total / Valor vendido" />
          <SummaryItem label="Ticket médio" value={formatCurrency(ticketMedio)} hint="Valor médio por unidade" />
          <SummaryItem label="Desconto de ICMS" value={formatCurrency(totalDiscount)} hint="Base para FUNCAFÉ e PIS/COFINS" />
          {includeSt ? (
            <SummaryItem label="ST total" value={formatCurrency(Number(section.totals.st ?? 0))} hint="Substituição Tributária estimada" />
          ) : null}
        </div>
      </header>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Notas fiscais detalhadas</h3>
        {hasLines ? (
          <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
            <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
              <table className="w-full table-fixed divide-y divide-[var(--color-border-subtle)] text-left text-[0.72rem]">
                <colgroup>
                  <col className="w-[110px]" />
                  <col className="w-[110px]" />
                  <col className="w-[150px]" />
                  <col className="w-[150px]" />
                  <col className="w-[140px]" />
                  <col className="w-[150px]" />
                  {includeSt ? <col className="w-[120px]" /> : null}
                  <col className="w-[150px]" />
                </colgroup>
                <thead className="bg-[var(--color-gray-50)] text-[var(--color-text-secondary)]">
                  <tr className="text-[0.65rem] uppercase tracking-[0.24em]">
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 font-semibold">NF</th>
                    <th className="px-3 py-2 font-semibold text-right">Total</th>
                    <th className="px-3 py-2 font-semibold text-right">ICMS líquido</th>
                    <th className="px-3 py-2 font-semibold text-right">FUNCAFÉ</th>
                    <th className="px-3 py-2 font-semibold text-right">PIS/COFINS</th>
                    {includeSt ? <th className="px-3 py-2 font-semibold text-right">ST</th> : null}
                    <th className="px-3 py-2 font-semibold text-right">Imposto final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)] text-[var(--color-text-primary)]">
                  {section.lines.map((line) => (
                    <tr key={line.id} className="align-top">
                      <td className="px-3 py-2">{line.issueDate ? formatDate(line.issueDate) : '--'}</td>
                      <td className="px-3 py-2 font-mono text-[0.65rem]">{line.invoiceNumber ?? '--'}</td>
                      <TotalTableCell total={line.baseValueTotal} unitValue={line.unitValue} />
                      <TaxTableCell pair={line.icmsLiquido} />
                      <TaxTableCell pair={line.funcafe} />
                      <TaxTableCell pair={line.pisCofins} />
                      {includeSt ? <TaxTableCell pair={line.st} /> : null}
                      <TaxTableCell pair={line.finalTax} highlight />
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[var(--color-gray-50)] text-[var(--color-text-primary)]">
                  <tr>
                    <td className="px-3 py-2 font-semibold" colSpan={2}>Totais</td>
                    <TotalTableCell total={section.totals.salesValue} highlight />
                    <TaxTotalsCell value={section.totals.icmsLiquido} />
                    <TaxTotalsCell value={section.totals.funcafe} />
                    <TaxTotalsCell value={section.totals.pisCofins} />
                    {includeSt ? <TaxTotalsCell value={section.totals.st ?? '0'} /> : null}
                    <TaxTotalsCell value={section.totals.finalTax} highlight />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-[0.65rem] text-[var(--color-text-secondary)]">
              Cada célula mostra o total da nota na primeira linha e o valor por unidade na segunda.
            </p>
          </section>
        ) : (
          <EmptyState
            title="Nenhuma venda encontrada"
            description="Não identificamos notas para esse CFOP no período selecionado."
          />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Resumo por produto</h3>
          {hasProductSummary ? (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
              <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[var(--color-surface-root)] text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] shadow-sm">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Produto</th>
                    <th className="px-3 py-2 font-semibold text-right">Qtd</th>
                    <th className="px-3 py-2 font-semibold text-right">Valor vendido</th>
                    <th className="px-3 py-2 font-semibold text-right">Imposto total</th>
                    <th className="px-3 py-2 font-semibold text-right">Imposto/unid.</th>
                    <th className="px-3 py-2 font-semibold text-right">Carga efetiva</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)] bg-white">
                  {section.productSummary.map((product) => (
                    <tr key={`${product.productId ?? product.productName}`}>
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">
                        <span className="block">{product.productName}</span>
                        <span className="text-[0.65rem] text-[var(--color-text-secondary)]">
                          {product.ncm ? `NCM ${product.ncm}` : 'NCM não informado'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                        {formatNumber(product.totalQuantity, { maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                        {formatCurrency(product.totalSalesValue)}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                        {formatCurrency(product.totalFinalTax)}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                        {formatCurrency(product.taxPerUnit)}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                        {`${formatNumber(product.effectiveTaxRate, { maximumFractionDigits: 2 })}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Nenhum produto encontrado"
              description="Não há consolidado por produto para este conjunto de notas."
            />
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Ranking por NCM (carga tributária)</h3>
          {hasNcmRanking ? (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
              <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[var(--color-surface-root)] text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] shadow-sm">
                  <tr>
                    <th className="px-3 py-2 font-semibold">NCM</th>
                    <th className="px-3 py-2 font-semibold text-right">Qtd</th>
                    <th className="px-3 py-2 font-semibold text-right">Valor vendido</th>
                    <th className="px-3 py-2 font-semibold text-right">Imposto total</th>
                    <th className="px-3 py-2 font-semibold text-right">Carga efetiva</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)] bg-white">
                  {section.ncmRanking.map((row) => (
                    <tr key={row.ncm ?? 'sem-ncm'}>
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">
                        {row.ncm ?? 'NCM não informado'}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                        {formatNumber(row.totalQuantity, { maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                        {formatCurrency(row.totalSalesValue)}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                        {formatCurrency(row.totalFinalTax)}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                        {`${formatNumber(row.effectiveTaxRate, { maximumFractionDigits: 2 })}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Nenhum NCM encontrado"
              description="Sem movimentações para montar o ranking por NCM neste período."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function FunruralSectionView({ section, onPrintSection }: { section: FunruralSection; onPrintSection: () => void }) {
  const totalQuantity = Number(section.totals.quantity);
  const totalPurchase = Number(section.totals.purchaseValue);
  const totalFunrural = Number(section.totals.funrural);
  const effectiveRate = totalPurchase > 0 ? (totalFunrural / totalPurchase) * 100 : 0;
  const ticketMedio = totalQuantity > 0 ? totalPurchase / totalQuantity : 0;
  const hasLines = section.lines.length > 0;
  const hasProductSummary = section.productSummary.length > 0;

  return (
    <section className="space-y-5 rounded-2xl border border-[var(--color-border-subtle)] bg-white p-6 shadow-sm">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Tributo 3 — FUNRURAL na compra de café cru</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              CFOP 1.101 provenientes de produtor rural (CPF). Alíquota de 1,5% aplicada sobre o valor unitário de compra.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onPrintSection}>
            Imprimir tributo
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Notas elegíveis" value={section.lines.length.toString()} hint="Entradas de produtor rural (pessoa física)" />
          <SummaryItem label="Unidades compradas" value={formatNumber(totalQuantity, { maximumFractionDigits: 4 })} hint="Somatório das quantidades" />
          <SummaryItem label="Valor comprado" value={formatCurrency(totalPurchase)} hint="Base de cálculo (valor do produto)" />
          <SummaryItem label="FUNRURAL devido" value={formatCurrency(totalFunrural)} hint="1,5% sobre o valor de compra" />
          <SummaryItem label="Carga efetiva" value={`${formatNumber(effectiveRate, { maximumFractionDigits: 2 })}%`} hint="FUNRURAL / Valor comprado" />
          <SummaryItem label="Valor médio unidade" value={formatCurrency(ticketMedio)} hint="Ticket médio de compra" />
        </div>
      </header>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Notas de compra</h3>
        {hasLines ? (
          <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
            <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
              <table className="w-full table-fixed divide-y divide-[var(--color-border-subtle)] text-left text-[0.72rem]">
                <colgroup>
                  <col className="w-[120px]" />
                  <col className="w-[120px]" />
                  <col className="w-[180px]" />
                  <col className="w-[180px]" />
                </colgroup>
                <thead className="bg-[var(--color-gray-50)] text-[var(--color-text-secondary)]">
                  <tr className="text-[0.65rem] uppercase tracking-[0.24em]">
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 font-semibold">NF</th>
                    <th className="px-3 py-2 font-semibold text-right">Total</th>
                    <th className="px-3 py-2 font-semibold text-right">FUNRURAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)] text-[var(--color-text-primary)]">
                  {section.lines.map((line) => (
                    <tr key={line.id} className="align-top">
                      <td className="px-3 py-2">{line.issueDate ? formatDate(line.issueDate) : '--'}</td>
                      <td className="px-3 py-2 font-mono text-[0.65rem]">{line.invoiceNumber ?? '--'}</td>
                      <TotalTableCell total={line.baseValueTotal} unitValue={line.unitValue} />
                      <TaxTableCell pair={line.funrural} highlight />
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[var(--color-gray-50)] text-[var(--color-text-primary)]">
                  <tr>
                    <td className="px-3 py-2 font-semibold" colSpan={2}>Totais</td>
                    <TotalTableCell total={section.totals.purchaseValue} highlight />
                    <TaxTotalsCell value={section.totals.funrural} highlight />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-[0.65rem] text-[var(--color-text-secondary)]">
              Total considera o valor comprado na nota e o valor por unidade na linha secundária.
            </p>
          </section>
        ) : (
          <EmptyState
            title="Nenhuma compra elegível"
            description="Não encontramos entradas com CFOP 1.101 de produtores rurais no período filtrado."
          />
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Resumo por produto</h3>
        {hasProductSummary ? (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
            <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--color-surface-root)] text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] shadow-sm">
                <tr>
                  <th className="px-3 py-2 font-semibold">Produto</th>
                  <th className="px-3 py-2 font-semibold text-right">Qtd</th>
                  <th className="px-3 py-2 font-semibold text-right">Valor compra</th>
                  <th className="px-3 py-2 font-semibold text-right">FUNRURAL</th>
                  <th className="px-3 py-2 font-semibold text-right">FUNRURAL/unid.</th>
                  <th className="px-3 py-2 font-semibold text-right">Carga efetiva</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)] bg-white">
                {section.productSummary.map((product) => (
                  <tr key={`${product.productId ?? product.productName}`}>
                    <td className="px-3 py-2 text-[var(--color-text-primary)]">
                      <span className="block">{product.productName}</span>
                      <span className="text-[0.65rem] text-[var(--color-text-secondary)]">
                        {product.ncm ? `NCM ${product.ncm}` : 'NCM não informado'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {formatNumber(product.totalQuantity, { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                      {formatCurrency(product.totalPurchaseValue)}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                      {formatCurrency(product.totalFunrural)}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)] whitespace-nowrap">
                      {formatCurrency(product.taxPerUnit)}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {`${formatNumber(product.effectiveTaxRate, { maximumFractionDigits: 2 })}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nenhum produto consolidado"
            description="Sem compras elegíveis para gerar consolidação por produto."
          />
        )}
      </div>
    </section>
  );
}

function SummaryItem({
  label,
  value,
  hint,
  variant = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  variant?: 'default' | 'accent' | 'highlight';
}) {
  const containerClass =
    variant === 'highlight'
      ? 'bg-[var(--color-brand-primary)] text-white border-transparent shadow-sm'
      : variant === 'accent'
      ? 'bg-[var(--color-brand-secondary)]/10 text-[var(--color-text-primary)] border-[var(--color-brand-secondary)]/30'
      : 'bg-[var(--color-gray-50)] text-[var(--color-text-primary)] border-[var(--color-border-subtle)]';

  const hintClass =
    variant === 'highlight'
      ? 'text-[0.65rem] text-white/80'
      : 'text-[0.65rem] text-[var(--color-text-secondary)]';

  const labelClass =
    variant === 'highlight'
      ? 'text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/90'
      : 'text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]';

  const valueClass =
    variant === 'highlight'
      ? 'mt-1 text-lg font-semibold text-white'
      : 'mt-1 text-base font-semibold text-[var(--color-text-primary)]';

  return (
    <div className={`rounded-xl border px-3 py-2 transition ${containerClass}`}>
      <p className={labelClass}>{label}</p>
      <p className={valueClass}>{value}</p>
      <p className={hintClass}>{hint}</p>
    </div>
  );
}

function TaxTableCell({ pair, highlight }: { pair: MoneyPair | null; highlight?: boolean }) {
  if (!pair) {
    return <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">--</td>;
  }
  return (
    <td className="px-3 py-2 text-right">
      <span
        className={`block text-sm font-semibold whitespace-nowrap ${highlight ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-primary)]'}`}
      >
        {formatCurrency(pair.total)}
      </span>
      <span className="block text-[0.6rem] text-[var(--color-text-secondary)] whitespace-nowrap">
        {formatCurrency(pair.unit)} por un.
      </span>
    </td>
  );
}

function TaxTotalsCell({ value, highlight = false }: { value: string; highlight?: boolean }) {
  if (value == null) {
    return <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">--</td>;
  }
  return (
    <td
      className={`px-3 py-2 text-right font-semibold ${highlight ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-primary)]'}`}
    >
      {formatCurrency(value)}
    </td>
  );
}

function TotalTableCell({
  total,
  unitValue,
  highlight = false,
}: {
  total: string | number | null;
  unitValue?: string | number | null;
  highlight?: boolean;
}) {
  if (total == null) {
    return <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">--</td>;
  }
  const totalFormatted = formatCurrency(total);
  const unitFormatted = unitValue != null ? formatCurrency(unitValue) : null;

  return (
    <td className="px-3 py-2 text-right">
      <span
        className={`block text-sm font-semibold whitespace-nowrap ${highlight ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-primary)]'}`}
      >
        {totalFormatted}
      </span>
      {unitFormatted ? (
        <span className="block text-[0.6rem] text-[var(--color-text-secondary)] whitespace-nowrap">
          {unitFormatted} por un.
        </span>
      ) : null}
    </td>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
      <span className="inline-flex h-5 w-5 animate-spin items-center justify-center rounded-full border-2 border-[var(--color-brand-primary)] border-t-transparent" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
      <p className="font-semibold text-[var(--color-text-primary)]">{title}</p>
      <p className="text-xs text-[var(--color-text-secondary)]/80">{description}</p>
    </div>
  );
}
