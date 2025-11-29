'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { Badge } from '@/ui/badge';
import { useCompanyContext } from '../../_context/company-context';

type DetailResponse = {
  natureza: { id: string; natOp: string | null; descricao: string | null; cfopCode: string | null; cfopType: 'IN' | 'OUT'; includeInReports: boolean };
  invoices: Array<{ id: string; chave: string; emissao: string | null; type: 'IN' | 'OUT'; totalNFe: string }>;
  products: Array<{ productId: string; product?: { name: string; sku: string | null }; invoiceItem?: { gross: string } }>;
};

export default function NaturezaDetailPage() {
  const params = useParams<{ id: string }>();
  const naturezaId = params?.id;
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destOptions, setDestOptions] = useState<Array<{ id: string; label: string; natOp?: string | null; cfopCode?: string | null }>>([]);
  const [remapTarget, setRemapTarget] = useState('');
  const [remapStatus, setRemapStatus] = useState<string | null>(null);
  const [remapLoading, setRemapLoading] = useState(false);
  const [dreInclude, setDreInclude] = useState(false);
  const [dreCategory, setDreCategory] = useState('');
  const [dreLabel, setDreLabel] = useState('');

  useEffect(() => {
    if (!selectedCompanyId || !naturezaId) return;
    setLoading(true);
    setError(null);
    fetchJson<DetailResponse>(`/companies/${selectedCompanyId}/naturezas/${naturezaId}/detail`)
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar detalhes.'))
      .finally(() => setLoading(false));
  }, [naturezaId, selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setDestOptions([]);
      return;
    }
    fetchJson<{ items: Array<{ naturezaOperacaoId: string | null; descricao: string | null; natOp: string | null; cfopCode: string | null }> }>(
      `/companies/${selectedCompanyId}/naturezas`,
    )
      .then((res) => {
        const options = (res.items || [])
          .filter((item) => item.naturezaOperacaoId && item.naturezaOperacaoId !== naturezaId)
          .map((item) => ({
            id: item.naturezaOperacaoId as string,
            label: `${item.descricao || item.natOp || 'Sem descrição'}${item.cfopCode ? ` · CFOP ${item.cfopCode}` : ''}`,
            natOp: item.natOp,
            cfopCode: item.cfopCode,
          }));
        setDestOptions(options);
      })
      .catch(() => {
        setDestOptions([]);
      });
  }, [selectedCompanyId]);

  const handleToggleInclude = async (value: boolean) => {
    if (!selectedCompanyId || !naturezaId) return;
    try {
      await fetchJson(`/companies/${selectedCompanyId}/naturezas/${naturezaId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeInReports: value }),
      });
      setData((prev) => (prev ? { ...prev, natureza: { ...prev.natureza, includeInReports: value } } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar configuração.');
    }
  };

  useEffect(() => {
    if (data?.natureza) {
      setDreInclude(Boolean(data.natureza.dreInclude));
      setDreCategory(data.natureza.dreCategory || '');
      setDreLabel(data.natureza.dreLabel || '');
    }
  }, [data?.natureza]);

  const handleRemapToTarget = async () => {
    if (!selectedCompanyId || !naturezaId) return;
    if (!remapTarget) {
      setRemapStatus('Escolha uma natureza de destino.');
      return;
    }
    setRemapLoading(true);
    setRemapStatus(null);
    try {
      const payload = {
        targetNaturezaOperacaoId: remapTarget,
        sourceNaturezaOperacaoIds: [naturezaId],
        sourceNatOps: data?.natureza?.natOp ? [data.natureza.natOp] : [],
      };

      const result = await fetchJson<{ updatedInvoices?: number; itemsUpdated?: number }>(
        `/companies/${selectedCompanyId}/naturezas/remap`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const msg = `Conciliação aplicada: ${result.updatedInvoices ?? 0} notas e ${result.itemsUpdated ?? 0} itens movidos.`;
      setRemapStatus(msg);
      const refreshed = await fetchJson<DetailResponse>(`/companies/${selectedCompanyId}/naturezas/${naturezaId}/detail`);
      setData(refreshed);
    } catch (err) {
      setRemapStatus(err instanceof Error ? err.message : 'Falha ao aplicar conciliação.');
    } finally {
      setRemapLoading(false);
    }
  };

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Natureza</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Detalhe da natureza</h1>
          {selectedCompany ? <span className="text-xs text-[var(--color-text-secondary)]">{selectedCompany.name}</span> : null}
        </div>
        <Link href="/app/naturezas" className="text-xs font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:underline">
          Voltar para a lista
        </Link>
      </header>

      {loading ? <p className="text-sm text-[var(--color-text-secondary)]">Carregando...</p> : null}
      {error ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm text-[var(--color-feedback-danger)]">
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <section className="space-y-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {data.natureza.descricao || data.natureza.natOp || 'Sem descrição'}
                </h2>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  CFOP {data.natureza.cfopCode || '—'} · Tipo {data.natureza.cfopType === 'IN' ? 'Entrada' : 'Saída'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={data.natureza.includeInReports}
                    onChange={(e) => void handleToggleInclude(e.target.checked)}
                    className="h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
                  />
                  Incluir em relatórios
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={dreInclude}
                    onChange={async (e) => {
                      const next = e.target.checked;
                      setDreInclude(next);
                      try {
                        await fetchJson(`/companies/${selectedCompanyId}/naturezas/${naturezaId}/config`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ dreInclude: next }),
                        });
                        setData((prev) => (prev ? { ...prev, natureza: { ...prev.natureza, dreInclude: next } } : prev));
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Falha ao atualizar DRE.');
                        setDreInclude(!next);
                      }
                    }}
                    className="h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
                  />
                  Incluir no DRE
                </label>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                  <span>Categoria DRE</span>
                  <select
                    value={dreCategory}
                    onChange={async (e) => {
                      const next = e.target.value;
                      setDreCategory(next);
                      try {
                        await fetchJson(`/companies/${selectedCompanyId}/naturezas/${naturezaId}/config`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ dreCategory: next || null }),
                        });
                        setData((prev) => (prev ? { ...prev, natureza: { ...prev.natureza, dreCategory: next || null } } : prev));
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Falha ao atualizar categoria DRE.');
                        setDreCategory(data?.natureza?.dreCategory || '');
                      }
                    }}
                    className="h-9 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                  >
                    <option value="">Não definido</option>
                    <option value="REVENUE">Receita</option>
                    <option value="RETURN">Devolução</option>
                    <option value="DEDUCTION">Dedução</option>
                    <option value="CMV">CMV</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                  <span>Descrição para DRE</span>
                  <input
                    value={dreLabel}
                    onChange={async (e) => {
                      const next = e.target.value;
                      setDreLabel(next);
                      try {
                        await fetchJson(`/companies/${selectedCompanyId}/naturezas/${naturezaId}/config`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ dreLabel: next }),
                        });
                        setData((prev) => (prev ? { ...prev, natureza: { ...prev.natureza, dreLabel: next } } : prev));
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Falha ao atualizar descrição DRE.');
                        setDreLabel(data?.natureza?.dreLabel || '');
                      }
                    }}
                    className="h-9 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                    placeholder="Ex.: Vendas Zona Franca"
                  />
                </label>
              </div>
            </div>

            <div className="mt-2 space-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-primary)]">Conciliação (origem → destino)</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Esta natureza é a origem. Escolha a natureza de destino para mover todas as notas/itens.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRemapToTarget}
                  disabled={remapLoading || !remapTarget}
                  className="rounded-md bg-[var(--color-brand-primary)] px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-70"
                >
                  {remapLoading ? 'Aplicando...' : 'Aplicar conciliação'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={remapTarget}
                  onChange={(e) => setRemapTarget(e.target.value)}
                  className="h-9 min-w-[240px] rounded-md border border-[var(--color-border-subtle)] bg-white px-2 text-sm shadow-sm"
                >
                  <option value="">Selecione o destino</option>
                  {destOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="text-[0.75rem] text-[var(--color-text-secondary)]">
                  Origem: {data.natureza.descricao || data.natureza.natOp || 'NatOp desta página'}
                </span>
              </div>
              {remapStatus ? <p className="text-xs text-[var(--color-text-primary)]">{remapStatus}</p> : null}
            </div>

            {/* Aliases removidos por decisão: foco apenas em conciliação direta */}            
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 shadow-sm">
              <header className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Notas (amostra)</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">Últimas 50 notas desta natureza</p>
                </div>
              </header>
              {data.invoices.length ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
                    <thead className="bg-[var(--color-gray-50)] text-[0.7rem] uppercase tracking-wide text-[var(--color-text-secondary)]">
                      <tr>
                        <th className="px-2 py-2">Chave</th>
                        <th className="px-2 py-2">Tipo</th>
                        <th className="px-2 py-2">Emissão</th>
                        <th className="px-2 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {data.invoices.map((inv) => (
                        <tr key={inv.id} className="bg-white">
                          <td className="px-2 py-2 font-mono text-[0.75rem] text-[var(--color-text-primary)]">{inv.chave}</td>
                          <td className="px-2 py-2 text-[var(--color-text-secondary)]">{inv.type}</td>
                          <td className="px-2 py-2 text-[var(--color-text-secondary)]">{inv.emissao ? formatDate(inv.emissao) : '—'}</td>
                          <td className="px-2 py-2 text-right text-[var(--color-text-primary)]">{formatCurrency(inv.totalNFe) ?? 'R$ --'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Nenhuma nota listada.</p>
              )}
            </div>

            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 shadow-sm">
              <header className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Produtos vinculados (amostra)</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">Itens mapeados com esta natureza</p>
                </div>
              </header>
              {data.products.length ? (
                <div className="mt-2 space-y-2">
                  {data.products.map((p, idx) => (
                    <div key={`${p.productId}-${idx}`} className="rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                      <p className="text-[var(--color-text-primary)] font-semibold">
                        {p.product?.name || 'Produto'} {p.product?.sku ? `· ${p.product.sku}` : ''}
                      </p>
                      <p>Valor item: {formatCurrency(p.invoiceItem?.gross ?? '0') ?? 'R$ --'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Nenhum produto listado.</p>
              )}
            </div>
          </section>
        </>
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">Selecione uma empresa e escolha uma natureza.</p>
      )}
    </div>
  );
}
