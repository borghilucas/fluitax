'use client';

import type { ComponentType } from 'react';
import { useCallback, useEffect, useMemo, useState, startTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, GitBranch, LayoutDashboard, Package2, Percent, ShieldCheck, UploadCloud, Warehouse } from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Skeleton } from '@/ui/skeleton';
import { Toast } from '@/ui/toast';
import { CompanyProvider, useCompanyContext } from './app/_context/company-context';
import { formatCnpj } from '@/lib/format';
import { fetchJson, ApiError } from '@/lib/api';

type ToastMessage = {
  id: string;
  title: string;
  message?: string;
  variant?: 'success' | 'warning' | 'danger' | 'info';
  actionLabel?: string;
  onAction?: () => void;
};

type CompanySummaryResponse = {
  summary: {
    totalInvoices: number;
    totalItems: number;
    outbound: { count: number; total: string };
    inbound: { count: number; total: string };
    grandTotal: string;
  };
  productOverview: {
    totalProducts: number;
    mappedItems: number;
    unmappedItems: number;
    totalItems: number;
  };
};

function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed right-6 top-6 z-50 flex flex-col gap-3">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          title={toast.title}
          message={toast.message}
          variant={toast.variant}
          actionLabel={toast.actionLabel}
          onAction={
            toast.onAction
              ? () => {
                  toast.onAction?.();
                  onDismiss(toast.id);
                }
              : undefined
          }
          onDismiss={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}

type QuickLink = {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

function formatNumber(value: number | string) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return '--';
  return new Intl.NumberFormat('pt-BR').format(numeric);
}

function QuickAccessCard({ link }: { link: QuickLink }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      className="group flex h-full flex-col justify-between rounded-2xl border border-[var(--color-border-subtle)] bg-white p-5 shadow-sm transition hover:border-[var(--color-brand-accent)]/40 hover:shadow-md focus-visible:outline-focus-visible"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-gray-100)] text-[var(--color-brand-secondary)] group-hover:bg-[var(--color-brand-accent)]/10 group-hover:text-[var(--color-brand-primary)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{link.title}</h3>
      </div>
      <p className="mt-3 text-sm text-[var(--color-text-secondary)]">{link.description}</p>
      <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-brand-secondary)] transition group-hover:text-[var(--color-brand-primary)]">
        Abrir
        <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

function HomeContent() {
  const router = useRouter();
  const { selectedCompany, selectedCompanyId } = useCompanyContext();
  const [isNavigating, setIsNavigating] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [insights, setInsights] = useState<CompanySummaryResponse | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    setToasts((prev) => [...prev, { id: Math.random().toString(36).slice(2), ...toast }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const handleEnterConsole = useCallback(() => {
    if (!selectedCompanyId) {
      pushToast({
        title: 'Selecione uma empresa',
        message: 'Escolha ou cadastre uma empresa para acessar o console operacional.',
        variant: 'danger',
        actionLabel: 'Selecionar empresa',
        onAction: () => router.push('/app/companies'),
      });
      return;
    }

    setIsNavigating(true);
    startTransition(() => {
      router.push('/app');
    });
  }, [pushToast, router, selectedCompanyId]);

  const quickLinks = useMemo<QuickLink[]>(() => {
    const companyDescription = selectedCompany
      ? `${selectedCompany.name} • CNPJ ${formatCnpj(selectedCompany.cnpj)}`
      : 'Selecione uma empresa para habilitar o console operacional.';

    return [
      {
        key: 'operate',
        title: 'Operar empresa',
        description: companyDescription,
        href: selectedCompany ? '/app' : '/app/companies',
        icon: LayoutDashboard,
      },
      {
        key: 'import',
        title: 'Importar XML',
        description: 'Envie lotes de NF-e e automatize a conciliação fiscal.',
        href: '/app/upload',
        icon: UploadCloud,
      },
      {
        key: 'products',
        title: 'Produtos & Conciliação',
        description: 'Mapeie itens das notas ao portfólio gerencial com conversões.',
        href: '/app/products',
        icon: Package2,
      },
      {
        key: 'discounts',
        title: 'Descontos incondicionais',
        description: 'Base contábil dos descontos permanentes aplicados nas notas de venda.',
        href: '/app/reports/unconditional-discounts',
        icon: Percent,
      },
      {
        key: 'warehouse',
        title: 'Armazém geral',
        description: 'Analise movimentações de estoque e saldo em tempo real.',
        href: '/app/reports/warehouse-general',
        icon: Warehouse,
      },
    ];
  }, [selectedCompany]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setInsights(null);
      return;
    }
    setIsLoadingInsights(true);
    fetchJson<CompanySummaryResponse>(`/companies/${selectedCompanyId}/summary`)
      .then((data) => {
        setInsights(data);
      })
      .catch((error) => {
        const message = error instanceof ApiError ? error.message : 'Não foi possível carregar os indicadores.';
        pushToast({ title: 'Erro ao carregar indicadores', message, variant: 'danger' });
      })
      .finally(() => setIsLoadingInsights(false));
  }, [selectedCompanyId, pushToast]);

  return (
    <div className="min-h-screen bg-[var(--color-surface-root)] text-[var(--color-text-primary)]">
      <div className="layout-container flex min-h-screen flex-col justify-start pb-16 pt-10">
        <section className="w-full rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-10 py-12 shadow-sm">
          <div className="flex max-w-[820px] flex-col gap-8">
            <div className="space-y-3 text-left">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--color-text-secondary)]">FluiTax</p>
              <h1 className="text-[2.375rem] font-semibold leading-tight text-[var(--color-text-primary)]">Console operacional</h1>
              <p className="text-base leading-relaxed text-[var(--color-text-secondary)]">
                Acompanhe notas, produtos e indicadores fiscais em tempo real. Concilie XMLs, defina regras e gere relatórios com precisão contábil.
              </p>
            </div>

            {selectedCompany ? (
              <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-5 py-3 text-sm text-[var(--color-text-secondary)]">
                <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-accent)]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-brand-secondary)]">
                  Empresa atual:
                  <span className="text-sm font-medium normal-case tracking-normal text-[var(--color-text-primary)]">
                    {selectedCompany.name}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-secondary)] normal-case tracking-normal">
                    CNPJ {formatCnpj(selectedCompany.cnpj)}
                  </span>
                </span>
                <Link
                  href="/app/companies"
                  className="text-sm font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
                >
                  Trocar
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-100)] px-5 py-3 text-sm text-[var(--color-text-secondary)]">
                <Badge uppercase={false} variant="neutral">
                  Nenhuma empresa selecionada
                </Badge>
                <Link
                  href="/app/companies"
                  className="text-sm font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
                >
                  Selecionar ou cadastrar empresa
                </Link>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                size="lg"
                onClick={handleEnterConsole}
                disabled={isNavigating}
                className="shadow-lg transition hover:shadow-xl"
              >
                {isNavigating ? 'Carregando…' : 'Entrar no console'}
              </Button>
              <Link
                href="/app/companies"
                className="text-sm font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline focus-visible:outline-focus-visible"
              >
                Ver empresas
              </Link>
            </div>

            {isNavigating ? <Skeleton className="h-2 w-48 rounded-full" /> : null}
          </div>
        </section>

        {selectedCompanyId ? (
          <section className="mt-10 space-y-6">
            <header className="space-y-1 text-left">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Indicadores da empresa</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Totais consolidados a partir dos dados reais.
              </p>
            </header>
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  key: 'invoices',
                  title: 'Notas registradas',
                  value: insights ? formatNumber(insights.summary.totalInvoices) : '—',
                  href: '/app/invoices',
                  icon: FileText,
                },
                {
                  key: 'mapped',
                  title: 'Itens mapeados',
                  value: insights ? formatNumber(insights.productOverview.mappedItems) : '—',
                  href: '/app/products',
                  icon: GitBranch,
                },
                {
                  key: 'gross',
                  title: 'Valor total NF-e',
                  value: insights ? `R$ ${formatNumber(Number(insights.summary.grandTotal))}` : '—',
                  href: '/app/reports/warehouse-general',
                  icon: ShieldCheck,
                },
              ].map((insight) => {
                const Icon = insight.icon;
                return (
                  <div
                    key={insight.key}
                    className="flex h-full flex-col gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                        <Icon className="h-5 w-5 text-[var(--color-brand-secondary)]" aria-hidden="true" />
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{insight.title}</span>
                      </div>
                      {isLoadingInsights ? (
                        <Skeleton className="h-5 w-16 rounded" />
                      ) : (
                        <span className="font-mono text-2xl font-semibold text-[var(--color-brand-secondary)] tabular-nums">
                          {insight.value}
                        </span>
                      )}
                    </div>
                    <Link
                      href={insight.href}
                      className="text-sm font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline focus-visible:outline-focus-visible"
                    >
                      Ver detalhes
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="mt-12 space-y-6">
          <header className="space-y-1 text-left">
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Acesso rápido</h2>
            <p className="max-w-[62ch] text-sm text-[var(--color-text-secondary)]">
              Vá direto aos módulos mais utilizados do console para importar XMLs, conciliar produtos e revisar indicadores fiscais.
            </p>
          </header>
          <div className="grid grid-cols-4 gap-4">
            {quickLinks.map((link) => (
              <QuickAccessCard key={link.key} link={link} />
            ))}
          </div>
        </section>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function Home() {
  return (
    <CompanyProvider>
      <HomeContent />
    </CompanyProvider>
  );
}
