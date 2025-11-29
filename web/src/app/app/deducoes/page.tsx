'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { useCompanyContext } from '../_context/company-context';
import { Button } from '@/ui/button';

type Deduction = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  amount: string;
};

export default function DeducoesPage() {
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const [items, setItems] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', startDate: '', endDate: '', amount: '' });

  useEffect(() => {
    if (!selectedCompanyId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetchJson<{ items: Deduction[] }>(`/companies/${selectedCompanyId}/deducoes`)
      .then((res) => setItems(res.items || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar deduções.'))
      .finally(() => setLoading(false));
  }, [selectedCompanyId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    try {
      await fetchJson(`/companies/${selectedCompanyId}/deducoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setForm({ title: '', startDate: '', endDate: '', amount: '' });
      const res = await fetchJson<{ items: Deduction[] }>(`/companies/${selectedCompanyId}/deducoes`);
      setItems(res.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar dedução.');
    }
  };

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Operações</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Deduções para DRE</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Cadastre deduções manuais por período (ex.: ICMS, PIS/COFINS) para compor o DRE.</p>
        <Link href="/app/menus/operacoes" className="text-xs font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:underline">
          Voltar para operações
        </Link>
      </header>

      {!selectedCompanyId ? (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4 text-sm text-[var(--color-text-secondary)]">
          Selecione uma empresa para gerenciar deduções.
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Nova dedução</h2>
            <form className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={handleSubmit}>
              <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                <span>Descrição</span>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="h-9 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                  placeholder="Ex.: ICMS"
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                <span>Data início</span>
                <input
                  type="date"
                  required
                  value={form.startDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="h-9 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                <span>Data fim</span>
                <input
                  type="date"
                  required
                  value={form.endDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="h-9 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                <span>Valor</span>
                <input
                  required
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  className="h-9 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                  placeholder="Ex.: 10000,00"
                />
              </label>
              <div className="md:col-span-2 lg:col-span-4">
                <Button type="submit">Salvar dedução</Button>
              </div>
            </form>
          </section>

          <section className="rounded-lg border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Deduções cadastradas</h2>
              {loading ? <span className="text-xs text-[var(--color-text-secondary)]">Carregando…</span> : null}
            </div>
            {error ? (
              <div className="mt-2 rounded-md border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-xs text-[var(--color-feedback-danger)]">
                {error}
              </div>
            ) : null}
            {items.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">Nenhuma dedução cadastrada.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
                  <thead className="bg-[var(--color-gray-50)] text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                    <tr>
                      <th className="px-2 py-2">Descrição</th>
                      <th className="px-2 py-2">Período</th>
                      <th className="px-2 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {items.map((item) => (
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
            )}
          </section>
        </>
      )}
    </div>
  );
}
