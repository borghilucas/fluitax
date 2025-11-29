'use client';

import Link from 'next/link';
import * as React from 'react';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Package2,
  GitBranch,
  CircleDot,
  Building2,
  Activity,
  ClipboardList,
  TrendingUp,
  Percent,
  Warehouse,
  LineChart,
  Truck,
} from 'lucide-react';

type SectionKey = 'contexto' | 'operacoes' | 'configuracoes' | 'relatorios';

const sectionMap: Record<
  SectionKey,
  { title: string; description: string; links: Array<{ href: string; label: string; icon: React.ComponentType<any> }> }
> = {
  contexto: {
    title: 'Contexto',
    description: 'Gerencie empresas e selecione o ambiente de trabalho.',
    links: [{ href: '/app/companies', label: 'Gerenciar empresas', icon: Building2 }],
  },
  operacoes: {
    title: 'Operações',
    description: 'Fluxos principais do dia a dia.',
    links: [
      { href: '/app', label: 'Painel', icon: LayoutDashboard },
      { href: '/app/upload', label: 'Importar XML', icon: Upload },
      { href: '/app/invoices', label: 'Notas fiscais', icon: FileText },
      { href: '/app/ctes', label: 'CT-e', icon: Truck },
      { href: '/app/products', label: 'Produtos', icon: Package2 },
      { href: '/app/deducoes', label: 'Deduções (DRE)', icon: Percent },
    ],
  },
  configuracoes: {
    title: 'Configurações',
    description: 'Parametrize naturezas, CFOP e status do sistema.',
    links: [
      { href: '/app/naturezas', label: 'Naturezas de Operação', icon: GitBranch },
      { href: '/app/cfop-rules', label: 'Regras CFOP', icon: CircleDot },
      { href: '/app/companies', label: 'Empresas', icon: Building2 },
      { href: '/app/health', label: 'Status do sistema', icon: Activity },
    ],
  },
  relatorios: {
    title: 'Relatórios',
    description: 'Visões gerenciais e fiscais.',
    links: [
      { href: '/app/reports/kardex/movimentacao', label: 'Kardex: movimentação', icon: ClipboardList },
      { href: '/app/reports/kardex/consumo', label: 'Kardex: consumo por produto', icon: ClipboardList },
      { href: '/app/reports/tributos', label: 'Tributos (OLG)', icon: FileText },
      { href: '/app/reports/sales-by-period', label: 'Vendas por período', icon: TrendingUp },
      { href: '/app/reports/unconditional-discounts', label: 'Descontos incondicionais', icon: Percent },
      { href: '/app/reports/warehouse-general', label: 'Armazém geral', icon: Warehouse },
      { href: '/app/reports/product-ledger', label: 'Entradas/Saídas por produto', icon: Package2 },
      { href: '/app/reports/management', label: 'Gestão / Fiscal', icon: LineChart },
      { href: '/app/reports/fiscal-close', label: 'Fechamento fiscal', icon: FileText },
      { href: '/app/reports/dre', label: 'DRE', icon: LineChart },
    ],
  },
};

export default function MenuSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const resolvedParams = React.use(params);
  const sectionKey = resolvedParams.section as SectionKey;
  const section = React.useMemo(() => sectionMap[sectionKey], [sectionKey]);

  if (!section) {
    return (
      <div className="px-4 py-6 text-sm text-[var(--color-text-secondary)]">
        Seção não encontrada. Escolha uma das categorias principais no menu lateral.
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Menu</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{section.title}</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">{section.description}</p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {section.links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm transition hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)]"
            >
              <Icon className="h-5 w-5 text-[var(--color-brand-secondary)]" aria-hidden="true" />
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
