'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import { useCompanyContext } from './_context/company-context';

type SummaryResponse = {
  company: {
    id: string;
    name: string;
    cnpj: string;
  };
  summary: {
    totalInvoices: number;
    totalItems: number;
    outbound: { count: number; total: string };
    inbound: { count: number; total: string };
    grandTotal: string;
  };
  period: {
    start: string | null;
    end: string | null;
  };
  recentInvoices: Array<{
    id: string;
    chave: string;
    emissao: string | null;
    type: 'IN' | 'OUT';
    totalNFe: string;
    issuerCnpj: string;
    recipientCnpj: string;
  }>;
  monthlyTotals: Array<{
    period: string;
    totals: { IN: string; OUT: string };
    invoices: number;
  }>;
  cfopBreakdown: Array<{
    cfopCode: string;
    invoices: number;
    grossTotal: string;
  }>;
  productOverview: {
    totalProducts: number;
    mappedItems: number;
    unmappedItems: number;
    totalItems: number;
  };
};

function formatCurrencySafe(value: string | number) {
  return formatCurrency(value) ?? 'R$ --';
}

export default function ConsoleDashboardPage() {
  const { selectedCompany, selectedCompanyId } = useCompanyContext();
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompanyId) {
      setData(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchJson<SummaryResponse>(`/companies/${selectedCompanyId}/summary`)
      .then((response) => {
        setData(response);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Não foi possível carregar o resumo.';
        setError(message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [selectedCompanyId]);

  const hasInvoices = useMemo(() => {
    if (!data) return false;
    return data.summary.totalInvoices > 0;
  }, [data]);

  if (!selectedCompany) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Selecione uma empresa para começar</h2>
        <p className="text-sm text-slate-600">
          Use o seletor no topo para escolher ou <Link className="text-slate-900 underline" href="/app/companies">cadastre uma nova empresa</Link> com seus dados reais.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 px-4 md:px-6">
      <section className="space-y-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Console</p>
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Visão geral de {selectedCompany.name}</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">CNPJ {selectedCompany.cnpj}</p>
            {data?.period.start && data.period.end ? (
              <p className="text-xs text-[var(--color-text-secondary)]">
                Cobertura entre {formatDate(data.period.start)} e {formatDate(data.period.end)}.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/app/upload">Importar XML</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/app/products">Produtos</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/app/invoices">Notas fiscais</Link>
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
          <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1">
            Inbound: {formatCurrencySafe(data?.summary.inbound.total ?? 0)}
          </span>
          <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1">
            Outbound: {formatCurrencySafe(data?.summary.outbound.total ?? 0)}
          </span>
          <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1">
            Itens pendentes: {data?.productOverview.unmappedItems ?? 0}
          </span>
        </div>
      </section>

      {isLoading ? (
        <section className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </section>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700">
          {error}
        </div>
      ) : !data ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          Nenhum dado disponível.
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[{
              label: 'Notas fiscais importadas',
              value: data.summary.totalInvoices,
            }, {
              label: 'Itens de nota',
              value: data.summary.totalItems,
            }, {
              label: 'Itens conciliados',
              value: data.productOverview.mappedItems,
            }, {
              label: 'Itens pendentes',
              value: data.productOverview.unmappedItems,
            }].map((card) => (
              <div key={card.label} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{card.label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
              <header className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Notas recentes</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">Últimas 5 notas fiscais importadas</p>
                </div>
                <Link
                  href="/app/invoices"
                  className="text-xs font-medium text-[var(--color-brand-secondary)] underline-offset-2 hover:underline"
                >
                  Abrir lista completa
                </Link>
              </header>
              {hasInvoices ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-white text-[0.7rem] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Chave</th>
                        <th className="px-4 py-2 font-medium">Tipo</th>
                        <th className="px-4 py-2 font-medium">Emissão</th>
                        <th className="px-4 py-2 font-medium">Destinatário</th>
                        <th className="px-4 py-2 font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {data.recentInvoices.map((invoice) => (
                        <tr key={invoice.id} className="bg-white">
                          <td className="px-4 py-2 font-mono text-[0.7rem] text-slate-700">{invoice.chave}</td>
                          <td className="px-4 py-2 text-[0.7rem] font-semibold text-slate-700">{invoice.type}</td>
                          <td className="px-4 py-2 text-[0.7rem] text-slate-600">
                            {invoice.emissao ? formatDate(invoice.emissao) : '--'}
                          </td>
                          <td className="px-4 py-2 text-[0.7rem] text-slate-600">{invoice.recipientCnpj}</td>
                          <td className="px-4 py-2 text-[0.7rem] text-slate-700">
                            {formatCurrencySafe(invoice.totalNFe)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-6 text-sm text-slate-600">
                  Nenhuma nota cadastrada para exibir. Faça upload para começar a analisá-las.
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Total consolidado</p>
                <p className="mt-2 text-3xl font-semibold text-[var(--color-text-primary)]">
                  {formatCurrencySafe(data.summary.grandTotal)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  Soma dos valores das notas importadas para esta empresa.
                </p>
              </div>

              <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Próximos passos</p>
                <ul className="mt-2 space-y-2 text-sm text-[var(--color-text-primary)]">
                  <li>• Valide os XMLs importados na aba de Upload.</li>
                  <li>• Navegue pelos itens e tributos em “Notas fiscais”.</li>
                  <li>• Concilie itens gerenciais em “Produtos”.</li>
                  <li>• Configure alíquotas em “Regras CFOP”.</li>
                  <li>• Planeje relatórios fiscais automatizados a partir destes dados.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
              <header className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Linha do tempo fiscal</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">Totais mensais de entradas e saídas</p>
                </div>
              </header>
              {data.monthlyTotals.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-white text-[0.7rem] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Mês</th>
                        <th className="px-4 py-2 font-medium">Entradas (IN)</th>
                        <th className="px-4 py-2 font-medium">Saídas (OUT)</th>
                        <th className="px-4 py-2 font-medium">Notas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {data.monthlyTotals.map((row) => (
                        <tr key={row.period} className="bg-white">
                          <td className="px-4 py-2 text-[0.75rem] font-mono text-slate-700">{row.period}</td>
                          <td className="px-4 py-2 text-[0.75rem] text-slate-700">{formatCurrencySafe(row.totals.IN)}</td>
                          <td className="px-4 py-2 text-[0.75rem] text-slate-700">{formatCurrencySafe(row.totals.OUT)}</td>
                          <td className="px-4 py-2 text-[0.75rem] text-slate-600">{row.invoices}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-6 text-sm text-slate-600">Sem dados históricos suficientes.</div>
              )}
            </div>

            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
              <header className="border-b border-[var(--color-border-subtle)] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Top CFOP</p>
                <p className="text-sm text-[var(--color-text-secondary)]">Itens mais recorrentes por CFOP</p>
              </header>
              {data.cfopBreakdown.length > 0 ? (
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-white text-[0.7rem] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">CFOP</th>
                      <th className="px-4 py-2 font-medium">Itens</th>
                      <th className="px-4 py-2 font-medium">Total bruto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.cfopBreakdown.map((entry) => (
                      <tr key={entry.cfopCode || 'cfop-null'} className="bg-white">
                        <td className="px-4 py-2 text-[0.75rem] font-mono text-slate-700">{entry.cfopCode || '--'}</td>
                        <td className="px-4 py-2 text-[0.75rem] text-slate-600">{entry.invoices}</td>
                        <td className="px-4 py-2 text-[0.75rem] text-slate-700">{formatCurrencySafe(entry.grossTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-4 py-6 text-sm text-slate-600">Nenhum item CFOP encontrado.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
