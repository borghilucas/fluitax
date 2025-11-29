'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { useCompanyContext } from '../../_context/company-context';

type LedgerItem = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  cfopCode?: string | null;
  natOp?: string | null;
  inQty: number;
  inValue: number;
  outQty: number;
  outGross: number;
  outNet: number;
  cogs: number;
};

type LedgerResponse = {
  items: LedgerItem[];
  filters: { companyId: string; from: string | null; to: string | null };
};

export default function ProductLedgerPage() {
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cfop, setCfop] = useState('');
  const [groupByCfop, setGroupByCfop] = useState(false);
  const [natOps, setNatOps] = useState<string[]>([]);
  const [availableNatOps, setAvailableNatOps] = useState<string[]>([]);
  const [naturezas, setNaturezas] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedNaturezas, setSelectedNaturezas] = useState<string[]>([]);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompanyId) {
      setAvailableNatOps([]);
      setNaturezas([]);
      return;
    }
    fetchJson<{ aliases: Array<{ natOp: string }>; items: Array<{ natOp: string | null }> }>(
      `/companies/${selectedCompanyId}/naturezas`,
    )
      .then((response) => {
        const set = new Set<string>();
        (response.items || []).forEach((item) => {
          if (item.natOp) set.add(item.natOp);
        });
        (response.aliases || []).forEach((alias) => {
          if (alias.natOp) set.add(alias.natOp);
        });
        setAvailableNatOps(Array.from(set));
      })
      .catch(() => {
        // silencioso; natOps podem ser carregadas após gerar o relatório
      });

    fetchJson<{ items: Array<{ naturezaOperacaoId: string | null; descricao: string | null; natOp: string | null; cfopCode: string | null }> }>(
      `/companies/${selectedCompanyId}/naturezas`,
    )
      .then((res) => {
        const options = (res.items || [])
          .filter((item) => item.naturezaOperacaoId)
          .map((item) => ({
            id: item.naturezaOperacaoId as string,
            label: `${item.descricao || item.natOp || 'Sem descrição'}${item.cfopCode ? ` · CFOP ${item.cfopCode}` : ''}`,
          }));
        setNaturezas(options);
      })
      .catch(() => {
        setNaturezas([]);
      });
  }, [selectedCompanyId]);

  const total = useMemo(() => {
    if (!data) return { inValue: 0, outGross: 0, outNet: 0, cogs: 0 };
    return data.items.reduce(
      (acc, item) => ({
        inValue: acc.inValue + item.inValue,
        outGross: acc.outGross + item.outGross,
        outNet: acc.outNet + item.outNet,
        cogs: acc.cogs + item.cogs,
      }),
      { inValue: 0, outGross: 0, outNet: 0, cogs: 0 },
    );
  }, [data]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId) {
      setError('Selecione uma empresa.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('companyId', selectedCompanyId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (cfop) params.set('cfop', cfop);
      if (groupByCfop) params.set('groupBy', 'cfop');
      if (natOps.length) params.set('natOps', natOps.join(','));
      if (selectedNaturezas.length) params.set('naturezaIds', selectedNaturezas.join(','));
      const response = await fetchJson<LedgerResponse>(`/reports/product-ledger?${params.toString()}`);
      setData(response);
      const natOpSet = new Set(response.items.map((i) => i.natOp).filter(Boolean) as string[]);
      setAvailableNatOps((prev) => {
        const next = new Set(prev);
        natOpSet.forEach((n) => next.add(n));
        return Array.from(next);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar relatório.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Relatórios</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Entradas e saídas por produto</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Totaliza entradas e saídas por SKU (quantidade e valor), incluindo receita bruta/líquida e custo (movimentos de estoque).
        </p>
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
          <span className="font-semibold">CFOP (opcional)</span>
          <input
            type="text"
            value={cfop}
            onChange={(event) => setCfop(event.target.value)}
            placeholder="ex.: 5102"
            className="h-9 rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
          <input
            type="checkbox"
            checked={groupByCfop}
            onChange={(event) => setGroupByCfop(event.target.checked)}
            className="h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
          />
          Agrupar por CFOP
        </label>
        <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Naturezas:</span>
          {availableNatOps.length === 0 ? (
            <span className="text-[var(--color-text-secondary)]">Carregue o relatório para listar</span>
          ) : (
            availableNatOps.map((nat) => (
              <button
                key={nat}
                type="button"
                onClick={() =>
                  setNatOps((prev) =>
                    prev.includes(nat) ? prev.filter((n) => n !== nat) : [...prev, nat],
                  )
                }
                className={`rounded-full border px-2 py-1 ${
                  natOps.includes(nat)
                    ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]'
                    : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]'
                }`}
              >
                {nat}
              </button>
            ))
          )}
          {natOps.length ? (
            <button
              type="button"
              onClick={() => setNatOps([])}
              className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[var(--color-text-secondary)] hover:text-[var(--color-brand-primary)]"
            >
              Limpar naturezas
            </button>
          ) : null}
        </div>
        {naturezas.length ? (
          <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-primary)]">
            <span className="font-semibold">Naturezas por ID:</span>
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
                  className="h-4 w-4"
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
                Limpar seleção
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          type="submit"
          className="rounded-md bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
        >
          {isLoading ? 'Carregando...' : 'Gerar'}
        </button>
        {selectedCompany ? (
          <span className="text-xs text-[var(--color-text-secondary)]">
            Empresa: {selectedCompany.name} — {selectedCompany.cnpj}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-secondary)]">Selecione uma empresa.</span>
        )}
      </form>

      {error ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm text-[var(--color-feedback-danger)]">
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2">
              <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Entradas (R$)</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(total.inValue) ?? 'R$ --'}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2">
              <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Saídas brutas (R$)</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(total.outGross) ?? 'R$ --'}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2">
              <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Saídas líquidas (R$)</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(total.outNet) ?? 'R$ --'}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2">
              <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">CMV (R$)</p>
              <p className="text-xl font-semibold text-[var(--color-text-primary)]">{formatCurrency(total.cogs) ?? 'R$ --'}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
            <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
              <thead className="bg-[var(--color-gray-50)] text-[0.7rem] uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-3 py-2">{groupByCfop ? 'CFOP' : 'Produto'}</th>
                  {!groupByCfop ? <th className="px-3 py-2">SKU</th> : null}
                  {!groupByCfop ? <th className="px-3 py-2">Unidade</th> : null}
                  {groupByCfop ? <th className="px-3 py-2">CFOP</th> : null}
                  <th className="px-3 py-2 text-right">Entradas (Qtd)</th>
                  <th className="px-3 py-2 text-right">Entradas (R$)</th>
                  <th className="px-3 py-2 text-right">Saídas (Qtd)</th>
                  <th className="px-3 py-2 text-right">Saídas brutas (R$)</th>
                  <th className="px-3 py-2 text-right">Saídas líquidas (R$)</th>
                  <th className="px-3 py-2 text-right">CMV (R$)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-sm text-[var(--color-text-secondary)]">
                      Nenhum dado para o filtro selecionado.
                    </td>
                  </tr>
                ) : (
                  data.items.map((item) => (
                    <tr key={`${item.productId ?? item.cfopCode ?? item.name}`} className="bg-white">
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">{item.name}</td>
                      {!groupByCfop ? <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.sku || '—'}</td> : null}
                      {!groupByCfop ? <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.unit || '—'}</td> : null}
                      {groupByCfop ? <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.cfopCode || '—'}</td> : null}
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{item.inQty.toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(item.inValue) ?? 'R$ --'}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{item.outQty.toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(item.outGross) ?? 'R$ --'}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(item.outNet) ?? 'R$ --'}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(item.cogs) ?? 'R$ --'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-3 text-sm text-[var(--color-text-secondary)]">
          Informe período (opcional) e gere o relatório. É necessário ter uma empresa selecionada.
        </div>
      )}

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
        <p className="font-semibold text-[var(--color-text-primary)]">Exportações</p>
        <p className="mt-1">
          Para exportar CSV/PDF, exponha endpoints semelhantes aos outros relatórios ou consuma este JSON direto do front.
        </p>
        <div className="mt-2 text-[var(--color-text-primary)]">
          <Link href="/app/menus/relatorios" className="underline-offset-4 hover:underline">
            Voltar aos relatórios
          </Link>
        </div>
      </div>
    </div>
  );
}
