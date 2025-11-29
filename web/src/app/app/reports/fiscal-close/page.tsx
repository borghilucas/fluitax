'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { useCompanyContext } from '../../_context/company-context';

type Row = {
  id: string;
  natureza: string;
  invoiceNumber: string;
  emissao: string | null;
  product: string;
  sku: string | null;
  qty: number;
  total: number;
  vTotTrib: number | null;
  vBC: number | null;
  vICMS: number | null;
  vICMSDeson: number | null;
  vBCST: number | null;
  vST: number | null;
  vDesc: number | null;
};

type Grouped = {
  [naturezaKey: string]: { natureza: string; rows: Row[]; totalsByProduct: Record<string, TotaisProduto> };
};

type Response = {
  grouped: { entradas: Grouped; saidas: Grouped };
  filters: { from: string | null; to: string | null; naturezaIds: string[] };
};

type TotaisProduto = {
  product: string;
  sku: string | null;
  qty: number;
  total: number;
  vTotTrib: number;
  vBC: number;
  vICMS: number;
  vICMSDeson: number;
  vBCST: number;
  vST: number;
  vDesc: number;
};

export default function FiscalClosePage() {
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [naturezas, setNaturezas] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedNaturezas, setSelectedNaturezas] = useState<string[]>([]);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompanyId) {
      setNaturezas([]);
      return;
    }
    fetchJson<{ items: Array<{ naturezaOperacaoId: string | null; descricao: string | null; natOp: string | null; cfopCode: string | null; invoiceCount?: number }> }>(
      `/companies/${selectedCompanyId}/naturezas`,
    )
      .then((res) => {
        const opts = (res.items || [])
          .filter((item) => item.naturezaOperacaoId && (item.invoiceCount ?? 0) > 0)
          .map((item) => ({
            id: item.naturezaOperacaoId as string,
            label: `${item.descricao || item.natOp || 'Sem descrição'}${item.cfopCode ? ` · CFOP ${item.cfopCode}` : ''}`,
          }));
        setNaturezas(opts);
      })
      .catch(() => setNaturezas([]));
  }, [selectedCompanyId]);

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
      if (selectedNaturezas.length) params.set('naturezaIds', selectedNaturezas.join(','));
      const response = await fetchJson<Response>(`/reports/fiscal-close?${params.toString()}`);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar relatório.');
    } finally {
      setLoading(false);
    }
  };

  const toExcelNumber = (value: number | null | undefined) => {
    if (value == null) return '';
    // converte para formato PT-BR com vírgula para facilitar colagem no Excel
    return value.toFixed(2).replace('.', ',');
  };

  const copyRows = async (title: string, rows: Row[]) => {
    if (!rows.length) return;
    const header = [
      'Nota Fiscal',
      'Data',
      'Produto',
      'SKU',
      'Qtd',
      'Total',
      'vTotTrib',
      'vBC',
      'vICMS',
      'vICMSDeson',
      'vBCST',
      'vST',
      'vDesc',
    ];
    const lines = rows.map((row) => [
      row.invoiceNumber,
      row.emissao ? formatDate(row.emissao) : '',
      row.product,
      row.sku ?? '',
      toExcelNumber(row.qty),
      toExcelNumber(row.total),
      toExcelNumber(row.vTotTrib ?? null),
      toExcelNumber(row.vBC ?? null),
      toExcelNumber(row.vICMS ?? null),
      toExcelNumber(row.vICMSDeson ?? null),
      toExcelNumber(row.vBCST ?? null),
      toExcelNumber(row.vST ?? null),
      toExcelNumber(row.vDesc ?? null),
    ]);
    const tsv = [header.join('\t'), ...lines.map((line) => line.join('\t'))].join('\n');
    await navigator.clipboard.writeText(tsv);
    setCopyFeedback(`Copiado "${title}" para a área de transferência`);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const copyTotals = async (title: string, totals: Record<string, TotaisProduto>) => {
    const list = Object.values(totals || {});
    if (!list.length) return;
    const header = ['Produto', 'SKU', 'Qtd', 'Total', 'vTotTrib', 'vBC', 'vICMS', 'vICMSDeson', 'vBCST', 'vST', 'vDesc'];
    const lines = list.map((row) => [
      row.product,
      row.sku ?? '',
      toExcelNumber(row.qty),
      toExcelNumber(row.total),
      toExcelNumber(row.vTotTrib ?? null),
      toExcelNumber(row.vBC ?? null),
      toExcelNumber(row.vICMS ?? null),
      toExcelNumber(row.vICMSDeson ?? null),
      toExcelNumber(row.vBCST ?? null),
      toExcelNumber(row.vST ?? null),
      toExcelNumber(row.vDesc ?? null),
    ]);
    const tsv = [header.join('\t'), ...lines.map((line) => line.join('\t'))].join('\n');
    await navigator.clipboard.writeText(tsv);
    setCopyFeedback(`Totais de "${title}" copiados para a área de transferência`);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const renderTotals = (totals: Record<string, TotaisProduto>) => {
    const list = Object.values(totals || {});
    if (!list.length) return null;
    return (
      <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-gray-50)]">
        <div className="px-4 py-2 text-xs font-semibold text-[var(--color-text-primary)]">Totais por produto</div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
            <thead className="bg-[var(--color-gray-100)] text-[0.65rem] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-2 py-2">Produto</th>
                <th className="px-2 py-2 text-right">Qtd</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">vTotTrib</th>
                <th className="px-2 py-2 text-right">vBC</th>
                <th className="px-2 py-2 text-right">vICMS</th>
                <th className="px-2 py-2 text-right">vICMSDeson</th>
                <th className="px-2 py-2 text-right">vBCST</th>
                <th className="px-2 py-2 text-right">vST</th>
                <th className="px-2 py-2 text-right">vDesc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {list.map((row, idx) => (
                <tr key={`${row.product}-${idx}`} className="bg-white">
                  <td className="px-2 py-2 text-[var(--color-text-primary)]">
                    <span className="font-semibold">{row.product}</span>
                    {row.sku ? <span className="text-[var(--color-text-secondary)]"> · {row.sku}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{formatNumber(row.qty)}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(row.total) ?? 'R$ --'}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(row.vTotTrib) ?? 'R$ --'}</td>
                  <td className="px-2 py-2 text-right">{row.vBC != null ? formatCurrency(row.vBC) : '—'}</td>
                  <td className="px-2 py-2 text-right">{row.vICMS != null ? formatCurrency(row.vICMS) : '—'}</td>
                  <td className="px-2 py-2 text-right">{row.vICMSDeson != null ? formatCurrency(row.vICMSDeson) : '—'}</td>
                  <td className="px-2 py-2 text-right">{row.vBCST != null ? formatCurrency(row.vBCST) : '—'}</td>
                  <td className="px-2 py-2 text-right">{row.vST != null ? formatCurrency(row.vST) : '—'}</td>
                  <td className="px-2 py-2 text-right">{row.vDesc != null ? formatCurrency(row.vDesc) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderGroup = (title: string, group: Grouped) => {
    const entries = Object.values(group);
    if (!entries.length) {
      return (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          Nenhum resultado para {title.toLowerCase()} com os filtros atuais.
        </div>
      );
    }
    return entries.map((bucket) => (
      <div key={bucket.natureza} className="rounded-lg border border-[var(--color-border-subtle)] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">{title}</p>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{bucket.natureza}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span>
              {bucket.rows.length} linha(s) — Total {formatCurrency(bucket.rows.reduce((sum, row) => sum + (row.total ?? 0), 0)) ?? 'R$ --'}
            </span>
            <button
              type="button"
              onClick={() => void copyRows(`${title} · ${bucket.natureza}`, bucket.rows)}
              className="rounded-md border border-[var(--color-border-subtle)] bg-white px-2 py-1 font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)]"
            >
              Copiar itens
            </button>
            <button
              type="button"
              onClick={() => void copyTotals(`${title} · ${bucket.natureza}`, bucket.totalsByProduct)}
              className="rounded-md border border-[var(--color-border-subtle)] bg-white px-2 py-1 font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)]"
            >
              Copiar totais
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
            <thead className="bg-[var(--color-gray-50)] text-[0.65rem] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-2 py-2">Nota Fiscal</th>
                <th className="px-2 py-2">Data</th>
                <th className="px-2 py-2">Produto</th>
                <th className="px-2 py-2 text-right">Qtd</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">vTotTrib</th>
                <th className="px-2 py-2 text-right">vBC</th>
                <th className="px-2 py-2 text-right">vICMS</th>
                <th className="px-2 py-2 text-right">vICMSDeson</th>
                <th className="px-2 py-2 text-right">vBCST</th>
                <th className="px-2 py-2 text-right">vST</th>
                <th className="px-2 py-2 text-right">vDesc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {bucket.rows.map((row) => (
                <tr key={row.id} className="bg-white">
                  <td className="px-2 py-2 font-mono text-[0.75rem] text-[var(--color-text-primary)]">{row.invoiceNumber}</td>
                  <td className="px-2 py-2 text-[var(--color-text-secondary)]">{row.emissao ? formatDate(row.emissao) : '—'}</td>
                  <td className="px-2 py-2 text-[var(--color-text-primary)]">
                    <span className="font-semibold">{row.product}</span>
                    {row.sku ? <span className="text-[var(--color-text-secondary)]"> · {row.sku}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-[var(--color-text-primary)]">{formatNumber(row.qty)}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(row.total) ?? 'R$ --'}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-secondary)]">{row.vTotTrib != null ? formatCurrency(row.vTotTrib) : '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-secondary)]">{row.vBC != null ? formatCurrency(row.vBC) : '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-secondary)]">{row.vICMS != null ? formatCurrency(row.vICMS) : '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-secondary)]">{row.vICMSDeson != null ? formatCurrency(row.vICMSDeson) : '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-secondary)]">{row.vBCST != null ? formatCurrency(row.vBCST) : '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-secondary)]">{row.vST != null ? formatCurrency(row.vST) : '—'}</td>
                  <td className="px-2 py-2 text-right text-[var(--color-text-secondary)]">{row.vDesc != null ? formatCurrency(row.vDesc) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {renderTotals(bucket.totalsByProduct)}
      </div>
    ));
  };

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Relatórios</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Fechamento fiscal</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Notas por natureza, separadas em entradas/saídas, com tributos e totais. Produtos já conciliados aparecem com SKU/nome.
        </p>
        <Link href="/app/menus/relatorios" className="text-xs font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:underline">
          Voltar para relatórios
        </Link>
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
        {naturezas.length ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-primary)]">
            <span className="font-semibold">Naturezas:</span>
            {naturezas.map((nat) => (
              <label key={nat.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-white px-2 py-1">
                <input
                  type="checkbox"
                  checked={selectedNaturezas.includes(nat.id)}
                  onChange={(e) =>
                    setSelectedNaturezas((prev) =>
                      e.target.checked ? [...prev, nat.id] : prev.filter((id) => id !== nat.id),
                    )
                  }
                />
                {nat.label}
              </label>
            ))}
            {selectedNaturezas.length ? (
              <button
                type="button"
                onClick={() => setSelectedNaturezas([])}
                className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[var(--color-text-secondary)] hover:text-[var(--color-brand-primary)]"
              >
                Limpar
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={loading || !selectedCompanyId}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-primary)] px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {loading ? 'Gerando...' : 'Gerar relatório'}
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm text-[var(--color-feedback-danger)]">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-5">
          {copyFeedback ? (
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2 text-xs text-[var(--color-text-primary)]">
              {copyFeedback}
            </div>
          ) : null}
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
            {selectedCompany ? <span className="font-semibold text-[var(--color-text-primary)]">{selectedCompany.name}</span> : null}{' '}
            {data.filters.from ? ` · Início: ${formatDate(data.filters.from)}` : ''}{' '}
            {data.filters.to ? ` · Fim: ${formatDate(data.filters.to)}` : ''}{' '}
            {data.filters.naturezaIds?.length ? ` · Naturezas filtradas: ${data.filters.naturezaIds.length}` : ''}
          </div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Entradas</h2>
          {renderGroup('Entradas', data.grouped.entradas)}
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Saídas</h2>
          {renderGroup('Saídas', data.grouped.saidas)}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Preencha os filtros e gere o relatório para ver os resultados.
        </div>
      )}
    </div>
  );
}
