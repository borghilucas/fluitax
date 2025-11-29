'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { useCompanyContext } from '../../_context/company-context';
import { getApiBaseUrl } from '@/lib/api';

type DreProduct = {
  product: string;
  sku: string | null;
  qty: number;
  total: number;
  avgPrice: number;
};

type DreGroup = {
  label: string;
  total: number;
  items: DreProduct[];
};

type DreResponse = {
  filters: { companyId: string; from: string | null; to: string | null };
  revenue: DreGroup[];
  returns: DreGroup[];
  cmv: DreGroup[];
  deductions: { total: number; items: Array<{ id: string; title: string; startDate: string; endDate: string; amount: string }> };
};

export default function DrePage() {
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<DreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fiscalYear, setFiscalYear] = useState<string>(new Date().getFullYear().toString());

  const totals = useMemo(() => {
    const revenueTotal = data?.revenue?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
    const returnsTotal = data?.returns?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
    const cmvTotal = data?.cmv?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
    const deductionsTotal = data?.deductions?.total ?? 0;
    const grossResult = revenueTotal - returnsTotal - cmvTotal;
    const netResult = revenueTotal - returnsTotal - deductionsTotal - cmvTotal;
    return { revenueTotal, returnsTotal, cmvTotal, deductionsTotal, grossResult, netResult };
  }, [data]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId) {
      setError('Selecione uma empresa.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('companyId', selectedCompanyId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await fetchJson<DreResponse>(`/reports/dre?${params.toString()}`);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar DRE.');
    } finally {
      setLoading(false);
    }
  };

  const setQuarter = (q: 1 | 2 | 3 | 4) => {
    const yearNum = Number(fiscalYear) || new Date().getFullYear();
    const startMonth = (q - 1) * 3;
    const start = new Date(Date.UTC(yearNum, startMonth, 1));
    const end = new Date(Date.UTC(yearNum, startMonth + 3, 0));
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  };

  const renderGroup = (title: string, groups: DreGroup[]) => {
    if (!groups.length) {
      return <p className="text-sm text-[var(--color-text-secondary)]">Nenhuma linha para {title.toLowerCase()}.</p>;
    }
    return (
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.label} className="rounded-lg border border-[var(--color-border-subtle)] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{group.label}</p>
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">{formatCurrency(group.total)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
                <thead className="bg-[var(--color-gray-50)] text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  <tr>
                    <th className="px-2 py-2">Produto</th>
                    <th className="px-2 py-2 text-right">Qtd</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2 text-right">Preço médio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {group.items.map((item, idx) => (
                    <tr key={`${item.product}-${idx}`} className="bg-white">
                      <td className="px-2 py-2 text-[var(--color-text-primary)]">
                        <span className="font-semibold">{item.product}</span>
                        {item.sku ? <span className="text-[var(--color-text-secondary)]"> · {item.sku}</span> : null}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{formatNumber(item.qty)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(item.total) ?? 'R$ --'}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(item.avgPrice) ?? 'R$ --'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Relatórios</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">DRE</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Apuração de resultados por natureza configurada, deduções manuais e visão por produto.</p>
        <div className="text-xs text-[var(--color-text-secondary)]">
          Naturezas configuradas em DRE (Receita, Devolução, Dedução, CMV) e deduções manuais lançadas em Operações &gt; Deduções.
        </div>
        <div className="text-xs text-[var(--color-text-secondary)]">
          <Link href="/app/deducoes" className="font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:underline">
            Gerenciar deduções manuais
          </Link>
        </div>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 shadow-sm" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Período início</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-9 rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Período fim</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-9 rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Ano (trimestre)</span>
          <input
            type="number"
            min="2000"
            max="2100"
            value={fiscalYear}
            onChange={(event) => setFiscalYear(event.target.value)}
            className="h-9 w-24 rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Atalhos de trimestre:</span>
          {[1, 2, 3, 4].map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuarter(q as 1 | 2 | 3 | 4)}
              className="rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 font-semibold hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)]"
            >
              T{q}/{fiscalYear}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={loading || !selectedCompanyId}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-primary)] px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {loading ? 'Gerando…' : 'Gerar DRE'}
        </button>
        {data ? (
          <Link
            href={`${getApiBaseUrl()}/reports/dre.pdf?companyId=${encodeURIComponent(
              selectedCompanyId || '',
            )}${from ? `&from=${encodeURIComponent(from)}` : ''}${to ? `&to=${encodeURIComponent(to)}` : ''}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] shadow-sm hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)]"
          >
            Baixar PDF
          </Link>
        ) : null}
      </form>

      {error ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm text-[var(--color-feedback-danger)]">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
            {selectedCompany ? <span className="font-semibold text-[var(--color-text-primary)]">{selectedCompany.name}</span> : null}{' '}
            {data.filters.from ? ` · Início: ${formatDate(data.filters.from)}` : ''}{' '}
            {data.filters.to ? ` · Fim: ${formatDate(data.filters.to)}` : ''}
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Receita</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(totals.revenueTotal)}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Devoluções</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(totals.returnsTotal)}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Deduções</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(totals.deductionsTotal)}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">CMV</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(totals.cmvTotal)}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Resultado bruto</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(totals.grossResult)}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Margem sobre receita: {totals.revenueTotal > 0 ? formatPercent(totals.grossResult / totals.revenueTotal, 1) : '--'}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Resultado líquido</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(totals.netResult)}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Margem líquida: {totals.revenueTotal > 0 ? formatPercent(totals.netResult / totals.revenueTotal, 1) : '--'}
              </p>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Receitas</h2>
            {renderGroup('Receitas', data.revenue)}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Devoluções</h2>
            {renderGroup('Devoluções', data.returns)}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">CMV</h2>
            {renderGroup('CMV', data.cmv)}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Deduções</h2>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Total de deduções</p>
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{formatCurrency(data.deductions.total)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
                  <thead className="bg-[var(--color-gray-50)] text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                    <tr>
                      <th className="px-2 py-2">Descrição</th>
                      <th className="px-2 py-2">Período</th>
                      <th className="px-2 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {data.deductions.items.map((item) => (
                      <tr key={item.id} className="bg-white">
                        <td className="px-2 py-2 text-[var(--color-text-primary)]">{item.title}</td>
                        <td className="px-2 py-2 text-[var(--color-text-secondary)]">
                          {formatDate(item.startDate)} — {formatDate(item.endDate)}
                        </td>
                        <td className="px-2 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Preencha os filtros e gere o DRE para ver os resultados.
        </div>
      )}
    </div>
  );
}
