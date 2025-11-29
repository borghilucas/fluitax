'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  GitBranch,
  LayoutDashboard,
  LineChart,
} from 'lucide-react';
import { useCompanyContext } from '../_context/company-context';

const mainSections = [
  { href: '/app/menus/contexto', label: 'Contexto', icon: Building2 },
  { href: '/app/menus/operacoes', label: 'Operações', icon: LayoutDashboard },
  { href: '/app/menus/configuracoes', label: 'Configurações', icon: GitBranch },
  { href: '/app/menus/relatorios', label: 'Relatórios', icon: LineChart },
] as const;

export function WorkspaceNav() {
  const pathname = usePathname();
  const { selectedCompanyId, selectedCompany } = useCompanyContext();

  return (
    <nav
      aria-label="Menu principal"
      className="w-full space-y-4 text-sm lg:w-[260px]"
    >
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 shadow-sm">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[var(--color-text-secondary)]">
          Empresa
        </p>
        {selectedCompany ? (
          <div className="mt-2 space-y-1">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{selectedCompany.name}</p>
            <p className="text-xs text-[var(--color-text-secondary)]">{selectedCompany.cnpj}</p>
            <Link
              href="/app/companies"
              className="text-xs font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline focus-visible:outline-focus-visible"
            >
              Trocar / gerenciar
            </Link>
          </div>
        ) : (
          <div className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
            <p>Nenhuma empresa selecionada.</p>
            <Link
              href="/app/companies"
              className="font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline focus-visible:outline-focus-visible"
            >
              Selecionar empresa
            </Link>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-3 shadow-sm">
        <p className="px-2 pb-3 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[var(--color-text-secondary)]">
          Navegação
        </p>
        <div className="space-y-1">
          {mainSections.map((link) => {
            const isActive = pathname.startsWith(link.href);
            const Icon = link.icon;
            const disabled = false; // principais sempre habilitados
            if (disabled) {
              return null;
            }
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 font-medium transition ${
                  isActive
                    ? 'border-[var(--color-brand-primary)]/50 bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)] shadow-sm'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-brand-accent)]/30 hover:bg-[var(--color-gray-100)] hover:text-[var(--color-brand-primary)]'
                }`}
                title={link.label}
              >
                <Icon
                  className={`h-4 w-4 ${
                    isActive ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-secondary)]'
                  }`}
                  aria-hidden="true"
                />
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
