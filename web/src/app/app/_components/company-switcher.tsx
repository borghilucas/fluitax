'use client';

import type { ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCompanyContext } from '../_context/company-context';
import { formatCnpj } from '@/lib/format';
import { Button } from '@/ui/button';

export function CompanySwitcher() {
  const router = useRouter();
  const {
    companies,
    isLoading,
    error,
    selectedCompanyId,
    selectedCompany,
    selectCompany,
    refreshCompanies,
  } = useCompanyContext();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    selectCompany(value || null);
  };

  const handleManage = () => {
    router.push('/app/companies');
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-2 text-sm text-[var(--color-text-primary)]" htmlFor="company-switcher">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Empresa</span>
        <div className="flex items-center gap-3">
          <select
            id="company-switcher"
            value={selectedCompanyId ?? ''}
            onChange={handleChange}
            className="h-10 w-[320px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30 disabled:bg-[var(--color-gray-100)]"
            disabled={isLoading || companies.length === 0}
          >
            <option value="">{isLoading ? 'Carregando…' : 'Selecione uma empresa'}</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" variant="secondary" onClick={handleManage} className="whitespace-nowrap">
            Gerenciar
          </Button>
        </div>
      </label>

      {selectedCompany ? (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2 text-xs text-[var(--color-text-secondary)] shadow-sm">
          <span className="block text-sm font-medium text-[var(--color-text-primary)]" title={selectedCompany.name}>
            {selectedCompany.name}
          </span>
          <span className="font-mono tabular-nums text-[var(--color-text-primary)]">
            CNPJ {formatCnpj(selectedCompany.cnpj)}
          </span>
        </div>
      ) : (
        <span className="text-xs text-[var(--color-text-secondary)]">
          Selecione uma empresa para operar ou{' '}
          <Link className="underline decoration-dotted underline-offset-4" href="/app/companies">
            cadastre agora
          </Link>.
        </span>
      )}

      {!isLoading && companies.length === 0 && !error && (
        <span className="text-xs text-[var(--color-feedback-danger)]">
          Nenhuma empresa cadastrada.{' '}
          <Link className="underline decoration-dotted underline-offset-4" href="/app/companies">
            Cadastre agora
          </Link>.
        </span>
      )}
      {error && (
        <button
          type="button"
          onClick={() => {
            void refreshCompanies();
          }}
          className="w-fit rounded-lg border border-[var(--color-feedback-danger)] bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-xs font-semibold text-[var(--color-feedback-danger)] transition hover:bg-[var(--color-feedback-danger)]/15 focus-visible:outline-focus-visible"
        >
          Erro ao carregar. Tentar novamente
        </button>
      )}
    </div>
  );
}
