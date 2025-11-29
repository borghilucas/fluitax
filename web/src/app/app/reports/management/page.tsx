'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/api';
import { useCompanyContext } from '../../_context/company-context';

type CardProps = {
  title: string;
  description: string;
  items: Array<{ label: string; value: string; tone?: 'ok' | 'warn' | 'danger' }>;
};

function InfoCard({ title, description, items }: CardProps) {
  return (
    <section className="space-y-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 shadow-sm">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">{title}</p>
        <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
      </header>
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const tone =
            item.tone === 'danger'
              ? 'text-[var(--color-feedback-danger)]'
              : item.tone === 'warn'
                ? 'text-amber-700'
                : 'text-[var(--color-text-primary)]';
          return (
            <div key={item.label} className="rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 py-2">
              <p className="text-xs text-[var(--color-text-secondary)]">{item.label}</p>
              <p className={`text-lg font-semibold ${tone}`}>{item.value}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const placeholder = '--';

export default function ManagementReportsPage() {
  const { selectedCompanyId } = useCompanyContext();
  const [data, setData] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompanyId) {
      setData(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    fetchJson(`/reports/management/summary?companyId=${encodeURIComponent(selectedCompanyId)}`)
      .then((response) => setData(response))
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar resumo.'))
      .finally(() => setIsLoading(false));
  }, [selectedCompanyId]);

  const mapping = data?.mapping;
  const cfop = data?.cfop;
  const cancellations = data?.cancellations;
  const conversions = data?.conversions;
  const ncm = data?.ncm;

  return (
    <div className="space-y-6 px-4 md:px-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Relatórios</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Gestão / Contábil / Fiscal</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Estrutura base para consultas estratégicas. Conecte às APIs de analytics para preencher os números reais.
        </p>
      </header>
      {error ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm text-[var(--color-feedback-danger)]">
          {error}
        </div>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Carregando...</p>
      ) : null}

      <InfoCard
        title="Cobertura de mapeamento fiscal"
        description="% mapeado por período/empresa/CFOP e NatOp com pendências."
        items={[
          { label: 'Itens mapeados', value: mapping ? String(mapping.mappedItems) : placeholder },
          { label: 'Pendentes', value: mapping ? String(mapping.pendingItems) : placeholder, tone: 'warn' },
          { label: 'Sem CFOP/NatOp', value: mapping ? String(mapping.pendingByCfop?.length ? mapping.pendingByCfop[0]?.count ?? 0 : 0) : placeholder, tone: 'danger' },
        ]}
      />

      <InfoCard
        title="Resumo CFOP/Natureza"
        description="Volume de notas/itens/valor por CFOP e NatOp (entradas/saídas)."
        items={[
          { label: 'CFOP mais usado', value: cfop?.cfopTop?.[0]?.cfop ?? placeholder },
          { label: 'Entradas (R$)', value: cfop ? cfop.inboundTotal : placeholder },
          { label: 'Saídas (R$)', value: cfop ? cfop.outboundTotal : placeholder },
        ]}
      />

      <InfoCard
        title="Cancelamentos e duplicidades"
        description="Chaves canceladas/duplicadas por período/upload e impacto em valor."
        items={[
          { label: 'Canceladas', value: cancellations ? String(cancellations.cancelled) : placeholder, tone: 'warn' },
          { label: 'Duplicadas', value: cancellations ? String(cancellations.duplicates) : placeholder, tone: 'danger' },
          { label: 'Uploads', value: cancellations ? String(cancellations.uploads) : placeholder },
        ]}
      />

      <InfoCard
        title="Livro de entradas/saídas (pré-SPED)"
        description="Consolidação de notas com CFOP, base de cálculo e NCM por período."
        items={[
          { label: 'Entradas (R$)', value: cfop ? cfop.inboundTotal : placeholder },
          { label: 'Saídas (R$)', value: cfop ? cfop.outboundTotal : placeholder },
          { label: 'Notas', value: cfop ? String(cfop.invoices) : placeholder },
        ]}
      />

      <InfoCard
        title="Consumo/saída por produto"
        description="Quantidade e valor por produto, principais parceiros e variação de custo."
        items={[
          { label: 'Top produto', value: placeholder },
          { label: 'Parceiro principal', value: placeholder },
          { label: 'Variação de custo', value: placeholder, tone: 'warn' },
        ]}
      />

      <InfoCard
        title="Conversões de unidade"
        description="Itens que exigiram conversão, distribuição de fatores e outliers."
        items={[
          { label: 'Itens convertidos', value: conversions ? String(conversions.converted) : placeholder },
          { label: 'Outliers de fator', value: placeholder, tone: 'warn' },
          { label: 'Unidades críticas', value: placeholder, tone: 'danger' },
        ]}
      />

      <InfoCard
        title="Análise de NCM"
        description="Volume por NCM, ausentes ou divergentes entre item e catálogo."
        items={[
          { label: 'NCM ausente', value: ncm ? String(ncm.missing) : placeholder, tone: 'danger' },
          { label: 'Top NCM', value: ncm?.top?.[0]?.ncm ?? placeholder },
          { label: 'Qtd top NCM', value: ncm?.top?.[0]?.count ? String(ncm.top[0].count) : placeholder },
        ]}
      />

      <InfoCard
        title="Reprocessamentos / Upload log"
        description="Linha do tempo de uploads e auto-map com sucesso/erro por arquivo."
        items={[
          { label: 'Uploads', value: cancellations ? String(cancellations.uploads) : placeholder },
          { label: 'Auto-map falhos', value: placeholder, tone: 'warn' },
          { label: 'Último upload', value: cancellations?.lastUpload ? new Date(cancellations.lastUpload).toLocaleString('pt-BR') : placeholder },
        ]}
      />

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
        <p className="font-semibold text-[var(--color-text-primary)]">Próximos passos</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Conectar esta página aos endpoints de analytics (ex.: <code>/products/analytics</code> e consultas CFOP/NCM).</li>
          <li>Permitir filtros por empresa, período e tipo (entrada/saída) no topo da página.</li>
          <li>Exportar CSV/PDF para conferência contábil/fiscal.</li>
        </ul>
        <div className="mt-2 text-[var(--color-text-primary)]">
          <Link href="/app/upload" className="underline-offset-4 hover:underline">
            Ir para uploads
          </Link>{' '}
          ·{' '}
          <Link href="/app/products" className="underline-offset-4 hover:underline">
            Ir para produtos
          </Link>
        </div>
      </div>
    </div>
  );
}
