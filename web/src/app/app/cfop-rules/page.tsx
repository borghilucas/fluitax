'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Skeleton } from '@/ui/skeleton';
import { Toast } from '@/ui/toast';
import { useCompanyContext } from '../_context/company-context';

type CfopUsageItem = {
  naturezaOperacaoId: string | null;
  naturezaKey: string | null;
  natOp: string | null;
  descricao: string | null;
  cfopCode: string | null;
  type: 'IN' | 'OUT';
  invoiceCount: number;
  itemCount: number;
  grossTotal: string;
  cfopComposite: string | null;
  cfopDescription: string | null;
  rule: CfopRule | null;
};

type CfopRule = {
  type: 'IN' | 'OUT';
  description: string | null;
  icmsRate: string;
  ipiRate: string;
  pisRate: string;
  cofinsRate: string;
  funruralRate: string;
  updatedAt: string;
};

type CfopUsageResponse = {
  company: {
    id: string;
    name: string;
  };
  items: CfopUsageItem[];
  reprocess?: ReprocessMeta;
};

type ReprocessMeta = {
  enabled: boolean;
  apiEnabled: boolean | null;
  lastBatchId: string | null;
  lastBatchStatus: string | null;
  lastBatchCreatedAt: string | null;
  lastBatchStartedAt: string | null;
  lastBatchFinishedAt: string | null;
};

type RulePayload = {
  description: string;
  icmsRate: string;
  ipiRate: string;
  pisRate: string;
  cofinsRate: string;
  funruralRate: string;
};

type CfopReprocessSample = {
  invoiceId: string;
  cfop: string | null;
  oldComposite: string | null;
  newComposite: string | null;
};

type CfopReprocessSummary = {
  batchId: string;
  mode: 'dry-run' | 'commit';
  scanned: number;
  reprocessed: number;
  skipped: number;
  failed: number;
  warnings: string[];
  samples: CfopReprocessSample[];
  startedAt: string | null;
  finishedAt: string | null;
};

type ToastMessage = {
  id: string;
  type: 'info' | 'success' | 'error';
  message: string;
};

const defaultRule: RulePayload = {
  description: '',
  icmsRate: '',
  ipiRate: '',
  pisRate: '',
  cofinsRate: '',
  funruralRate: '',
};

const CFOP_REPROCESS_ENABLED =
  String(process.env.NEXT_PUBLIC_CFOP_REPROCESS_ENABLE ?? 'false').toLowerCase() === 'true';

function toCurrency(value: string) {
  return formatCurrency(value) ?? 'R$ --';
}

function normalizeRateInput(value: string) {
  if (!value) return '';
  return value.replace(',', '.');
}

function splitCfopComposite(composite: string | null, fallbackCode: string | null) {
  if (!composite) return null;
  const normalized = composite.trim();
  if (!normalized.length) {
    return null;
  }

  const compact = normalized.replace(/\s+/g, ' ');
  const dashedMatch = compact.match(/^(\d{4})\s*[-–—]\s*(.+)$/);
  if (dashedMatch) {
    const [, code, description] = dashedMatch;
    return {
      code,
      description: description.trim() || null,
    };
  }

  const fallback = fallbackCode?.trim() ?? null;
  if (fallback && compact.startsWith(fallback)) {
    const remainder = compact.slice(fallback.length).replace(/^[-–—\s]+/, '').trim();
    return {
      code: fallback,
      description: remainder.length ? remainder : null,
    };
  }

  return {
    code: fallback ?? compact,
    description: fallback ? (compact === fallback ? null : compact) : null,
  };
}

function formatDateTime(value: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date
    .toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    .replace(/\u00A0/g, ' ');
}

function formatRelativeLabel(reference: string | null) {
  if (!reference) return null;
  const target = new Date(reference);
  if (Number.isNaN(target.getTime())) {
    return null;
  }
  const now = Date.now();
  const diffMs = now - target.getTime();
  if (diffMs < 0) {
    return 'agora mesmo';
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 1) {
    return 'agora mesmo';
  }
  if (diffMinutes < 60) {
    return `há ${diffMinutes} min`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `há ${diffHours} h`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `há ${diffDays} d`;
}

export default function CfopRulesPage() {
  const { selectedCompany, selectedCompanyId } = useCompanyContext();
  const [items, setItems] = useState<CfopUsageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<RulePayload>(defaultRule);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reprocessMeta, setReprocessMeta] = useState<ReprocessMeta>({
    enabled: CFOP_REPROCESS_ENABLED,
    apiEnabled: null,
    lastBatchId: null,
    lastBatchStatus: null,
    lastBatchCreatedAt: null,
    lastBatchStartedAt: null,
    lastBatchFinishedAt: null,
  });
  const [isReprocessModalOpen, setReprocessModalOpen] = useState(false);
  const [reprocessMode, setReprocessMode] = useState<'dry-run' | 'commit'>('dry-run');
  const [reprocessOnlyMissing, setReprocessOnlyMissing] = useState(true);
  const [reprocessSince, setReprocessSince] = useState('');
  const [reprocessBatchSize, setReprocessBatchSize] = useState('500');
  const [reprocessIsSubmitting, setReprocessIsSubmitting] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const [reprocessResult, setReprocessResult] = useState<CfopReprocessSummary | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const createToastId = useCallback(
    () =>
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)),
    []
  );

  const showToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = createToastId();
    setToasts((prev) => [...prev, { id, type, message }]);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, 5000);
    }
  }, [createToastId]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const buildKey = useCallback(
    (naturezaKey: string | null, cfopCode: string | null, type: 'IN' | 'OUT') => {
      if (naturezaKey && naturezaKey.trim().length) {
        return `${naturezaKey}::${type}`;
      }
      return `${cfopCode ?? ''}::${type}`;
    },
    []
  );

  const sortItems = useCallback((list: CfopUsageItem[]) => {
    return [...list].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'OUT' ? -1 : 1;
      }
      const totalA = Number(a.grossTotal ?? '0');
      const totalB = Number(b.grossTotal ?? '0');
      return totalB - totalA;
    });
  }, []);

  const loadUsage = useCallback(
    async (companyId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchJson<CfopUsageResponse>(`/companies/${companyId}/cfop-usage`);
        const normalizedItems = (response.items ?? []).map((item) => ({
          ...item,
          naturezaKey:
            item.naturezaKey
            ?? item.naturezaOperacaoId
            ?? (item.natOp ? `natop:${item.natOp}::${item.cfopCode ?? ''}` : null),
          natOp: item.natOp ?? null,
          descricao: item.descricao ?? item.cfopDescription ?? null,
          cfopComposite: item.cfopComposite ?? null,
          cfopDescription: item.cfopDescription ?? item.descricao ?? null,
        }));
        const sorted = sortItems(normalizedItems);
        setItems(sorted);

        const meta = response.reprocess ?? null;
        setReprocessMeta({
          enabled: CFOP_REPROCESS_ENABLED,
          apiEnabled: typeof meta?.enabled === 'boolean' ? meta.enabled : null,
          lastBatchId: meta?.lastBatchId ?? null,
          lastBatchStatus: meta?.lastBatchStatus ?? null,
          lastBatchCreatedAt: meta?.lastBatchCreatedAt ?? null,
          lastBatchStartedAt: meta?.lastBatchStartedAt ?? null,
          lastBatchFinishedAt: meta?.lastBatchFinishedAt ?? null,
        });

        if (selectedKey) {
          const stillExists = sorted.some(
            (item) => buildKey(item.naturezaKey ?? null, item.cfopCode, item.type) === selectedKey
          );
          if (!stillExists) {
            setSelectedKey(null);
          }
        }

        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível carregar CFOPs.';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [buildKey, selectedKey, sortItems]
  );

  const activeItem = useMemo(
    () =>
      items.find(
        (item) => buildKey(item.naturezaKey ?? null, item.cfopCode, item.type) === selectedKey
      ) ?? null,
    [buildKey, items, selectedKey]
  );

  const companyResolved = Boolean(selectedCompany && selectedCompanyId);
  const canRenderReprocessCTA = Boolean(CFOP_REPROCESS_ENABLED && companyResolved);

  const lastBatchTimestamp = useMemo(() => {
    return (
      reprocessMeta.lastBatchFinishedAt ||
      reprocessMeta.lastBatchStartedAt ||
      reprocessMeta.lastBatchCreatedAt ||
      null
    );
  }, [reprocessMeta.lastBatchCreatedAt, reprocessMeta.lastBatchFinishedAt, reprocessMeta.lastBatchStartedAt]);

  const hasRecentReprocess = useMemo(() => {
    if (!lastBatchTimestamp) return false;
    const timestamp = new Date(lastBatchTimestamp);
    if (Number.isNaN(timestamp.getTime())) {
      return false;
    }
    const diffHours = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60);
    return diffHours <= 24;
  }, [lastBatchTimestamp]);

  const recentReprocessLabel = useMemo(() => formatRelativeLabel(lastBatchTimestamp), [lastBatchTimestamp]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setItems([]);
      setSelectedKey(null);
      setReprocessMeta({
        enabled: CFOP_REPROCESS_ENABLED,
        apiEnabled: null,
        lastBatchId: null,
        lastBatchStatus: null,
        lastBatchCreatedAt: null,
        lastBatchStartedAt: null,
        lastBatchFinishedAt: null,
      });
      return;
    }

    void loadUsage(selectedCompanyId);
  }, [loadUsage, selectedCompanyId]);

  useEffect(() => {
    if (!activeItem) {
      setFormValues(defaultRule);
      return;
    }
    const rule = activeItem.rule;
    if (!rule) {
      setFormValues(defaultRule);
      return;
    }

    setFormValues({
      description: rule.description ?? '',
      icmsRate: rule.icmsRate ?? '',
      ipiRate: rule.ipiRate ?? '',
      pisRate: rule.pisRate ?? '',
      cofinsRate: rule.cofinsRate ?? '',
      funruralRate: rule.funruralRate ?? '',
    });
  }, [activeItem]);

  const handleSelect = (naturezaKey: string | null, cfopCode: string | null, type: 'IN' | 'OUT') => {
    setSelectedKey(buildKey(naturezaKey, cfopCode, type));
    setFeedback(null);
  };

  const handleChange = (field: keyof RulePayload, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId || !activeItem) {
      setFeedback('Selecione um CFOP e uma empresa.');
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const payload = {
        description: formValues.description.trim(),
        icmsRate: normalizeRateInput(formValues.icmsRate),
        ipiRate: normalizeRateInput(formValues.ipiRate),
        pisRate: normalizeRateInput(formValues.pisRate),
        cofinsRate: normalizeRateInput(formValues.cofinsRate),
        funruralRate: normalizeRateInput(formValues.funruralRate),
        type: activeItem.type,
      };

      await fetchJson(`/companies/${selectedCompanyId}/cfop-rules/${encodeURIComponent(activeItem.cfopCode ?? '')}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      setFeedback('Regra salva com sucesso.');
      // Refresh usage list to reflect updated timestamps and rule summary
      await loadUsage(selectedCompanyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao salvar regra.';
      setFeedback(message);
    } finally {
      setIsSaving(false);
    }
  };

  const openReprocessModal = useCallback(() => {
    if (!canRenderReprocessCTA) {
      if (!selectedCompanyId || !selectedCompany) {
        showToast('error', 'Selecione uma empresa para continuar.');
      } else {
        showToast('error', 'O reprocessamento está desativado neste ambiente.');
      }
      return;
    }
    setReprocessModalOpen(true);
    setReprocessError(null);
    setReprocessResult(null);
  }, [canRenderReprocessCTA, selectedCompany, selectedCompanyId, showToast]);

  const closeReprocessModal = useCallback(() => {
    if (reprocessIsSubmitting) {
      return;
    }
    setReprocessModalOpen(false);
    setReprocessError(null);
  }, [reprocessIsSubmitting]);

  const handleReprocess = useCallback(
    async (modeToExecute: 'dry-run' | 'commit') => {
      if (!selectedCompanyId) {
        setReprocessError('Selecione uma empresa para continuar.');
        showToast('error', 'Selecione uma empresa para reprocessar os CFOPs.');
        return;
      }
      if (!canRenderReprocessCTA) {
        setReprocessError('O reprocessamento está desativado neste ambiente.');
        showToast('error', 'O reprocessamento está desativado neste ambiente.');
        return;
      }

      setReprocessMode(modeToExecute);
      setReprocessIsSubmitting(true);
      setReprocessError(null);
      setReprocessResult(null);

      const payload: Record<string, unknown> = {
        mode: modeToExecute,
        onlyMissing: reprocessOnlyMissing,
      };

      const parsedBatchSize = Number.parseInt(reprocessBatchSize, 10);
      if (Number.isFinite(parsedBatchSize) && parsedBatchSize > 0) {
        payload.batchSize = parsedBatchSize;
      }

      const trimmedSince = reprocessSince.trim();
      if (trimmedSince) {
        payload.since = trimmedSince;
      }

      try {
        const summary = await fetchJson<CfopReprocessSummary>(
          `/companies/${encodeURIComponent(selectedCompanyId)}/reprocess-cfop`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );

        setReprocessResult(summary);
        console.info('[CFOP] ReprocessBatch concluído', summary.batchId);

        if (summary.mode === 'commit') {
          if (summary.reprocessed > 0) {
            showToast('success', 'Reprocessamento concluído com sucesso.');
          } else {
            showToast('info', 'Nenhuma nota necessitava atualização.');
          }
        } else {
          showToast('info', 'Dry-run concluído. Revise as amostras antes de executar.');
        }

        await loadUsage(selectedCompanyId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha ao reprocessar CFOPs.';
        setReprocessError(message);
        if (message.trim() === 'Recurso não disponível.') {
          showToast('error', 'O reprocessamento está desativado neste ambiente.');
          setReprocessMeta((prev) => ({
            ...prev,
            enabled: false,
          }));
        } else {
          showToast('error', message);
        }
      } finally {
        setReprocessIsSubmitting(false);
      }
    },
    [
      canRenderReprocessCTA,
      loadUsage,
      reprocessBatchSize,
      reprocessOnlyMissing,
      reprocessSince,
      selectedCompanyId,
      showToast,
    ]
  );

  if (!selectedCompany) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Selecione uma empresa</h2>
        <p className="text-sm text-slate-600">
          Utilize o seletor no topo para escolher a empresa desejada e visualizar os CFOPs extraídos dos XMLs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Regras CFOP</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {selectedCompany.name} — CNPJ <span className="font-mono tabular-nums">{selectedCompany.cnpj}</span>
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]/80">
            Configure alíquotas e observações tributárias por CFOP. Esses parâmetros são usados em cálculos fiscais e relatórios.
          </p>
        </div>
        {canRenderReprocessCTA ? (
          <Button onClick={openReprocessModal} disabled={reprocessIsSubmitting} size="md">
            {reprocessIsSubmitting ? 'Processando…' : 'Reprocessar notas fiscais'}
          </Button>
        ) : null}
      </header>

      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">CFOPs identificados</span>
            {hasRecentReprocess && recentReprocessLabel && (
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[0.65rem] font-medium text-emerald-700">
                Reprocessado {recentReprocessLabel}
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--color-text-secondary)]/80">Total: {items.length}</span>
        </header>
        {isLoading ? (
          <div className="space-y-3 px-4 py-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-sm text-[var(--color-feedback-danger)]">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            Nenhum CFOP encontrado. Faça upload de XMLs para populá-los automaticamente.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 px-4 py-4">
            {(['OUT', 'IN'] as const).map((type) => {
              const filtered = items.filter((item) => item.type === type);
              const totals = filtered.reduce(
                (acc, item) => {
                  acc.invoices += item.invoiceCount ?? 0;
                  acc.items += item.itemCount ?? 0;
                  const totalValue = item.grossTotal ? Number(item.grossTotal) : 0;
                  acc.total += Number.isFinite(totalValue) ? totalValue : 0;
                  return acc;
                },
                { invoices: 0, items: 0, total: 0 },
              );
              return (
                <div key={type} className="rounded-2xl border border-[var(--color-border-subtle)] bg-white shadow-sm">
                  <header className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                      {type === 'OUT' ? 'Saídas (OUT)' : 'Entradas (IN)'}
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">{filtered.length} CFOP</span>
                  </header>
                  {filtered.length === 0 ? (
                    <p className="table-empty-state">Nenhum CFOP encontrado nesta categoria.</p>
                  ) : (
                    <div className="table-container border-0 shadow-none">
                      <table>
                        <thead>
                          <tr>
                            <th>CFOP</th>
                            <th>Natureza da operação</th>
                            <th className="table-align-right">Notas</th>
                            <th className="table-align-right">Itens</th>
                            <th className="table-align-right">Total bruto</th>
                            <th>Regra</th>
                            <th className="table-align-center">Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((item) => {
                            const key = buildKey(item.naturezaKey ?? null, item.cfopCode, item.type);
                            const isActive = selectedKey === key;
                            const ruleLabel = item.rule?.description || 'Não definida';
                            const isSelectable = Boolean(item.cfopCode);
                            const composite = splitCfopComposite(item.cfopComposite, item.cfopCode) ?? null;
                            const codeLabel = composite?.code ?? item.cfopCode ?? '--';
                            const descriptionLabel = item.descricao
                              ? item.descricao
                              : item.cfopDescription
                              ? item.cfopDescription
                              : composite?.description ?? null;
                            return (
                              <tr key={key} className={isActive ? 'bg-[var(--color-brand-accent)]/10' : undefined}>
                                <td className="font-mono text-[0.75rem] text-[var(--color-text-primary)]">{codeLabel}</td>
                                <td
                                  className="text-[0.7rem] text-[var(--color-text-secondary)]"
                                  title={item.natOp ?? undefined}
                                >
                                  {descriptionLabel && descriptionLabel.trim().length ? descriptionLabel : '—'}
                                </td>
                                <td className="table-align-right">{item.invoiceCount}</td>
                                <td className="table-align-right">{item.itemCount}</td>
                                <td className="table-align-right text-[var(--color-brand-primary)]">{toCurrency(item.grossTotal)}</td>
                                <td className="text-[0.75rem] text-[var(--color-text-secondary)] break-words">{ruleLabel}</td>
                                <td className="table-align-center">
                                  {isSelectable ? (
                                    <Button
                                      size="sm"
                                      variant={isActive ? 'primary' : 'secondary'}
                                      onClick={() => handleSelect(item.naturezaKey ?? null, item.cfopCode, item.type)}
                                    >
                                      {isActive ? 'Editando' : 'Editar'}
                                    </Button>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={2}>Totais</td>
                            <td className="table-align-right">{formatNumber(totals.invoices)}</td>
                            <td className="table-align-right">{formatNumber(totals.items)}</td>
                            <td className="table-align-right">{formatCurrency(totals.total)}</td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={Boolean(CFOP_REPROCESS_ENABLED && isReprocessModalOpen)}
        onClose={closeReprocessModal}
        size="xl"
        title="Reprocessar CFOPs"
        description={
          selectedCompanyId
            ? `Notas fiscais da empresa ${selectedCompanyId}.`
            : 'Notas fiscais da empresa selecionada.'
        }
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => handleReprocess('dry-run')}
              disabled={reprocessIsSubmitting || !canRenderReprocessCTA}
            >
              Dry-run
            </Button>
            <Button
              onClick={() => handleReprocess('commit')}
              disabled={reprocessIsSubmitting || !canRenderReprocessCTA}
            >
              Executar
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Atualiza o campo composto dos itens de nota desta empresa, registrando um lote de auditoria dedicado.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-2 text-sm text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">Data inicial (opcional)</span>
              <input
                type="date"
                value={reprocessSince}
                onChange={(event) => setReprocessSince(event.target.value)}
                disabled={reprocessIsSubmitting}
                className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30 disabled:cursor-not-allowed disabled:bg-[var(--color-gray-100)]"
              />
              <span className="text-xs text-[var(--color-text-secondary)]/80">Processa notas a partir desta data.</span>
            </label>

            <label className="grid gap-2 text-sm text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">Tamanho do lote</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={reprocessBatchSize}
                onChange={(event) => setReprocessBatchSize(event.target.value)}
                disabled={reprocessIsSubmitting}
                className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30 disabled:cursor-not-allowed disabled:bg-[var(--color-gray-100)]"
              />
              <span className="text-xs text-[var(--color-text-secondary)]/80">Padrão de 500 itens por transação.</span>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={reprocessOnlyMissing}
              onChange={(event) => setReprocessOnlyMissing(event.target.checked)}
              disabled={reprocessIsSubmitting}
              className="h-4 w-4 rounded border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)] disabled:cursor-not-allowed"
            />
            <span>Reprocessar apenas onde o campo composto estiver ausente.</span>
          </label>

          {reprocessError ? (
            <div
              role="alert"
              className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-4 py-3 text-sm text-[var(--color-feedback-danger)]"
            >
              {reprocessError}
            </div>
          ) : null}

          {reprocessIsSubmitting ? (
            <div className="space-y-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                Executando {reprocessMode === 'commit' ? 'commit' : 'dry-run'} em lotes de {reprocessBatchSize || '500'} itens
              </p>
              <div className="h-2 w-full rounded-full bg-[var(--color-gray-200)]">
                <div className="h-2 w-1/2 animate-pulse rounded-full bg-[var(--color-brand-accent)]/60" />
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]/80">Aguarde até o resumo final ser exibido.</p>
            </div>
          ) : null}

          {reprocessResult && !reprocessIsSubmitting ? (
            <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-emerald-900">Resumo do lote</span>
                <code className="rounded bg-emerald-100 px-2 py-1 text-[0.7rem] text-emerald-900">
                  {reprocessResult.batchId}
                </code>
                <span>
                  {reprocessResult.mode === 'commit' ? 'Execução' : 'Dry-run'} · {formatDateTime(reprocessResult.startedAt)} → {formatDateTime(reprocessResult.finishedAt)}
                </span>
              </div>

              <ul className="grid grid-cols-2 gap-2 text-xs text-emerald-900">
                <li>Notas avaliadas: {formatNumber(reprocessResult.scanned)}</li>
                <li>Itens atualizados: {formatNumber(reprocessResult.reprocessed)}</li>
                <li>Itens sem alteração: {formatNumber(reprocessResult.skipped)}</li>
                <li>Falhas: {formatNumber(reprocessResult.failed)}</li>
              </ul>

              {reprocessResult.samples.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-emerald-200 bg-white p-3 text-xs text-[var(--color-text-secondary)]">
                  <p className="font-semibold text-[var(--color-text-primary)]">Amostras de alterações</p>
                  <div className="max-h-48 overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
                    <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-[0.72rem]">
                      <thead className="bg-[var(--color-gray-100)] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                        <tr>
                          <th className="px-2 py-2 font-medium">Nota</th>
                          <th className="px-2 py-2 font-medium">CFOP</th>
                          <th className="px-2 py-2 font-medium">Antes</th>
                          <th className="px-2 py-2 font-medium">Depois</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border-subtle)] bg-white">
                        {reprocessResult.samples.map((sample) => (
                          <tr key={`${sample.invoiceId}-${sample.cfop ?? 'cfop'}`}>
                            <td className="px-2 py-2 font-mono text-[0.65rem] text-[var(--color-text-secondary)]">{sample.invoiceId}</td>
                            <td className="px-2 py-2 font-mono text-[0.65rem] text-[var(--color-text-secondary)]">{sample.cfop ?? '--'}</td>
                            <td className="px-2 py-2 text-[0.65rem] text-[var(--color-text-secondary)]">{sample.oldComposite ?? '--'}</td>
                            <td className="px-2 py-2 text-[0.65rem] text-[var(--color-text-secondary)]">{sample.newComposite ?? '--'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {reprocessResult.warnings.length > 0 ? (
                <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-semibold">Avisos</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {reprocessResult.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-[var(--color-text-secondary)]/80">
            Seguro e idempotente: valores fiscais permanecem inalterados.
          </p>
        </div>
      </Modal>

      {activeItem && (
        <section className="grid gap-6 [grid-template-columns:minmax(0,2fr)_minmax(0,1fr)]">
          <form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Regra tributária</p>
              <p className="text-sm text-slate-600">
                Defina os parâmetros para o CFOP{' '}
                <span className="font-mono">{activeItem.cfopCode || '--'}</span> —
                {activeItem.type === 'OUT' ? ' Saída (OUT)' : ' Entrada (IN)'}.
              </p>
              <p className="text-xs text-slate-500">
                Natureza associada: {activeItem.descricao || activeItem.natOp || '—'}
              </p>
            </div>

            <label className="grid gap-2 text-sm text-slate-700">
              <span className="font-medium">Descrição</span>
              <input
                name="description"
                value={formValues.description}
                onChange={(event) => handleChange('description', event.target.value)}
                placeholder="ex: Venda de produção própria"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              {([
                ['icmsRate', 'ICMS (%)'],
                ['ipiRate', 'IPI (%)'],
                ['pisRate', 'PIS (%)'],
                ['cofinsRate', 'COFINS (%)'],
                ['funruralRate', 'Funrural (%)'],
              ] as Array<[keyof RulePayload, string]>).map(([field, label]) => (
                <label key={field} className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium">{label}</span>
                  <input
                    name={field}
                    value={formValues[field]}
                    onChange={(event) => handleChange(field, event.target.value)}
                    placeholder="ex: 3.5"
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </label>
              ))}
            </div>

            <Button type="submit" disabled={isSaving} className="w-fit">
              {isSaving ? 'Salvando…' : 'Salvar regra'}
            </Button>

            {feedback && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                {feedback}
              </div>
            )}
          </form>

          <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Resumo</p>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex justify-between">
                <dt className="font-medium text-slate-700">Natureza da operação</dt>
                <dd>{activeItem.descricao || activeItem.natOp || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-slate-700">Notas vinculadas</dt>
                <dd>{activeItem.invoiceCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-slate-700">Itens importados</dt>
                <dd>{activeItem.itemCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-slate-700">Total bruto</dt>
                <dd>{toCurrency(activeItem.grossTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-slate-700">Operação</dt>
                <dd>{activeItem.type === 'OUT' ? 'Saída' : 'Entrada'}</dd>
              </div>
              {activeItem.rule?.updatedAt && (
                <div className="flex justify-between text-xs text-slate-500">
                  <dt>Última atualização</dt>
                  <dd>{new Date(activeItem.rule.updatedAt).toLocaleString('pt-BR')}</dd>
                </div>
              )}
            </dl>
          </aside>
        </section>
      )}
    </div>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-[60] flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          title={toast.message}
          variant={toast.type === 'error' ? 'danger' : toast.type === 'success' ? 'success' : 'info'}
          onDismiss={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}
