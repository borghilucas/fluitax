import type { ReactNode } from 'react';
import { CircleHelp, Search, UserRound } from 'lucide-react';
import { WorkspaceNav } from './_components/workspace-nav';
import { CompanyProvider } from './_context/company-context';
import { CompanySwitcher } from './_components/company-switcher';

export default function ConsoleLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <CompanyProvider>
      <div className="min-h-screen bg-[var(--color-surface-root)] text-[var(--color-text-primary)]">
        <header className="sticky top-0 z-40 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface-card)]/85">
          <div className="layout-container flex items-center gap-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-brand-primary)] text-sm font-semibold tracking-[0.2em] text-white shadow-sm">
                FT
              </div>
              <div className="leading-tight">
                <p className="text-[0.625rem] font-semibold uppercase tracking-[0.3em] text-[var(--color-text-secondary)]">
                  FluiTax
                </p>
                <p className="text-lg font-semibold text-[var(--color-brand-primary)]">Console operacional</p>
              </div>
            </div>

            <div className="flex flex-1 items-center gap-4">
              <label className="flex h-11 flex-1 items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-root)] px-4 text-sm text-[var(--color-text-secondary)] shadow-sm transition focus-within:border-[var(--color-brand-accent)] focus-within:ring-2 focus-within:ring-[var(--color-brand-accent)]/20">
                <Search className="h-4 w-4 text-[var(--color-text-secondary)]" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Buscar empresas, notas, produtos…"
                  className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
                  aria-label="Buscar no console"
                />
                <kbd className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-2 py-1 text-[0.65rem] font-semibold text-[var(--color-text-secondary)]">
                  ⌘K
                </kbd>
              </label>
              <div className="flex items-center gap-3">
                <CompanySwitcher />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] text-[var(--color-text-secondary)] transition hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
                    aria-label="Central de ajuda"
                    title="Central de ajuda"
                  >
                    <CircleHelp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-brand-primary)] text-white shadow-sm transition hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
                    aria-label="Perfil do operador"
                    title="Perfil do operador"
                  >
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="layout-container flex gap-6 py-8">
          <aside className="sticky top-[112px] h-fit w-[var(--sidebar-width)] shrink-0">
            <WorkspaceNav />
          </aside>
          <main className="layout-main flex min-h-[calc(100vh-200px)] flex-1 flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-6 shadow-sm">
            {children}
          </main>
        </div>
      </div>
    </CompanyProvider>
  );
}
