'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatNumber, formatDate } from '@/lib/format';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Modal } from '@/ui/modal';
import { Skeleton } from '@/ui/skeleton';
import { Toast } from '@/ui/toast';
import { useCompanyContext } from '../_context/company-context';

type NaturezaItem = {
  naturezaOperacaoId: string | null;
  naturezaKey: string;
  natOp: string | null;
  descricao: string | null;
  cfopCode: string | null;
  cfopType: 'IN' | 'OUT';
  isSelfIssuedEntrada: boolean;
  invoiceCount: number;
  itemCount: number;
  grossTotal: string;
  aliasNatOps: string[];
  isLegacy: boolean;
  includeInReports?: boolean;
};

type NaturezaAlias = {
  id: string;
  natOp: string;
  cfopCode: string;
  cfopType: 'IN' | 'OUT';
  targetNaturezaOperacaoId: string;
  targetNatOp: string | null;
  targetDescricao: string | null;
};

type NaturezasResponse = {
  company: {
    id: string;
    name: string;
  };
  items: NaturezaItem[];
  aliases: NaturezaAlias[];
};

type ToastMessage = {
  id: string;
  type: 'info' | 'success' | 'error';
  message: string;
};

function toCurrency(value: number | string) {
  return formatCurrency(value) ?? 'R$ --';
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed right-6 top-6 z-50 flex flex-col gap-3">
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

export default function NaturezasPage() {
  const { selectedCompany, selectedCompanyId } = useCompanyContext();
  const [items, setItems] = useState<NaturezaItem[]>([]);
  const [aliases, setAliases] = useState<NaturezaAlias[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [sourceNaturezaIds, setSourceNaturezaIds] = useState<Set<string>>(new Set());
  const [sourceNatOps, setSourceNatOps] = useState<Set<string>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [aliasModalTarget, setAliasModalTarget] = useState<NaturezaItem | null>(null);
  const [filterTerm, setFilterTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [onlyLegacy, setOnlyLegacy] = useState(false);
  const [savedFilters, setSavedFilters] = useState<
    Array<{ id: string; name: string; term: string; type: 'ALL' | 'IN' | 'OUT'; onlyLegacy: boolean }>
  >([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detailItem, setDetailItem] = useState<NaturezaItem | null>(null);
  const [detailData, setDetailData] = useState<{
    natureza?: { includeInReports: boolean; descricao: string | null; natOp: string | null; cfopCode: string | null; cfopType: 'IN' | 'OUT' };
    aliases?: Array<{ id: string; natOp: string; cfopCode: string | null; cfopType: 'IN' | 'OUT' }>;
    invoices?: Array<{ id: string; chave: string; emissao: string | null; type: 'IN' | 'OUT'; totalNFe: string }>;
    products?: Array<{ productId: string; product?: { name: string; sku: string | null }; invoiceItem?: { gross: string } }>;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [aliasForm, setAliasForm] = useState({ natOp: '', cfopCode: '', cfopType: 'OUT' as 'IN' | 'OUT' });
  const [createForm, setCreateForm] = useState({ natOp: '', descricao: '', cfopCode: '', cfopType: 'OUT' as 'IN' | 'OUT', includeInReports: true });

  const createToastId = useCallback(
    () =>
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)),
    []
  );

  const pushToast = useCallback(
    (type: ToastMessage['type'], message: string) => {
      const id = createToastId();
      setToasts((prev) => [...prev, { id, type, message }]);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 5000);
      }
    },
    [createToastId]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const filteredItems = useMemo(() => {
    const term = filterTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (filterType !== 'ALL' && item.cfopType !== filterType) return false;
      if (onlyLegacy && item.naturezaOperacaoId) return false;
      if (!term) return true;
      const haystack = [
        item.descricao,
        item.natOp,
        item.cfopCode,
        item.aliasNatOps?.join(' ') ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [filterTerm, filterType, items, onlyLegacy]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      if (a.cfopType !== b.cfopType) {
        return a.cfopType === 'OUT' ? -1 : 1;
      }
      const invoicesA = Number(a.invoiceCount ?? 0);
      const invoicesB = Number(b.invoiceCount ?? 0);
      if (invoicesA !== invoicesB) {
        return invoicesB - invoicesA;
      }
      const totalA = Number(a.grossTotal ?? '0');
      const totalB = Number(b.grossTotal ?? '0');
      if (totalA !== totalB) {
        return totalB - totalA;
      }
      if (a.cfopCode && b.cfopCode && a.cfopCode !== b.cfopCode) {
        return a.cfopCode.localeCompare(b.cfopCode);
      }
      return 0;
    });
  }, [filteredItems]);

  const naturezasTotals = useMemo(() => {
    return sortedItems.reduce(
      (acc, item) => {
        acc.invoices += item.invoiceCount ?? 0;
        acc.items += item.itemCount ?? 0;
        const total = item.grossTotal ? Number(item.grossTotal) : 0;
        acc.total += Number.isFinite(total) ? total : 0;
        return acc;
      },
      { invoices: 0, items: 0, total: 0 },
    );
  }, [sortedItems]);

  const totalPages = 1;
  const paginatedItems = sortedItems;

  useEffect(() => {
    setPage(1);
  }, [filterTerm, filterType, onlyLegacy]);

  const groupCounts = useMemo(() => {
    return {
      OUT: filteredItems.filter((item) => item.cfopType === 'OUT').length,
      IN: filteredItems.filter((item) => item.cfopType === 'IN').length,
    };
  }, [filteredItems]);

  const selectedSourcesCount = useMemo(
    () => sourceNaturezaIds.size + sourceNatOps.size,
    [sourceNaturezaIds, sourceNatOps]
  );

  const selectedTarget = useMemo(
    () => items.find((item) => item.naturezaOperacaoId === targetId) ?? null,
    [items, targetId]
  );

  const targetAliases = useMemo(() => {
    if (!aliasModalTarget?.naturezaOperacaoId) return [];
    return aliases.filter((alias) => alias.targetNaturezaOperacaoId === aliasModalTarget.naturezaOperacaoId);
  }, [aliasModalTarget?.naturezaOperacaoId, aliases]);

  const loadNaturezas = useCallback(
    async (companyId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchJson<NaturezasResponse>(`/companies/${companyId}/naturezas`);
        const normalizedItems = (response.items ?? []).map((item) => ({
          ...item,
          naturezaKey: item.naturezaKey ?? `${item.naturezaOperacaoId ?? 'legacy'}:${item.cfopCode ?? ''}`,
          aliasNatOps: item.aliasNatOps ?? [],
          isLegacy: item.isLegacy ?? !item.naturezaOperacaoId,
        }));
        setItems(normalizedItems);
        setAliases(response.aliases ?? []);

        if (targetId) {
          const targetStillExists = normalizedItems.some((item) => item.naturezaOperacaoId === targetId);
          if (!targetStillExists) {
            setTargetId(null);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível carregar naturezas.';
        setError(message);
        pushToast('error', message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [pushToast, targetId]
  );

  useEffect(() => {
    if (!selectedCompanyId) {
      setItems([]);
      setAliases([]);
      setTargetId(null);
      setSourceNaturezaIds(new Set());
      setSourceNatOps(new Set());
      return;
    }

    void loadNaturezas(selectedCompanyId);
  }, [loadNaturezas, selectedCompanyId]);

  const toggleSource = useCallback(
    (item: NaturezaItem) => {
      setSourceNaturezaIds((prev) => {
        const next = new Set(prev);
        if (item.naturezaOperacaoId) {
          if (next.has(item.naturezaOperacaoId)) {
            next.delete(item.naturezaOperacaoId);
          } else {
            next.add(item.naturezaOperacaoId);
          }
        }
        return next;
      });

      if (!item.naturezaOperacaoId && item.natOp) {
        setSourceNatOps((prev) => {
          const next = new Set(prev);
          const key = item.natOp?.trim();
          if (!key) {
            return next;
          }
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
      }
    },
    []
  );

  const isSourceChecked = useCallback(
    (item: NaturezaItem) => {
      if (item.naturezaOperacaoId) {
        return sourceNaturezaIds.has(item.naturezaOperacaoId);
      }
      if (item.natOp) {
        return sourceNatOps.has(item.natOp.trim());
      }
      return false;
    },
    [sourceNatOps, sourceNaturezaIds]
  );

  const clearSelection = useCallback(() => {
    setSourceNaturezaIds(new Set());
    setSourceNatOps(new Set());
    setMergeFeedback(null);
  }, []);

  const handleMerge = useCallback(async () => {
    if (!selectedCompanyId) {
      pushToast('error', 'Selecione uma empresa.');
      return;
    }
    if (!targetId) {
      pushToast('error', 'Escolha uma natureza de destino.');
      return;
    }
    if (sourceNaturezaIds.size === 0 && sourceNatOps.size === 0) {
      pushToast('error', 'Selecione ao menos uma natureza de origem.');
      return;
    }

    setIsMerging(true);
    setMergeFeedback(null);

    try {
      const payload: Record<string, unknown> = {
        targetNaturezaOperacaoId: targetId,
        actorId: 'web-ui',
      };

      if (sourceNaturezaIds.size) {
        payload.sourceNaturezaOperacaoIds = Array.from(sourceNaturezaIds);
      }
      if (sourceNatOps.size) {
        payload.sourceNatOps = Array.from(sourceNatOps);
      }

      const result = await fetchJson<{ updatedInvoices: number; itemsUpdated: number; aliasesConfigured?: number }>(
        `/companies/${selectedCompanyId}/naturezas/remap`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      const invoices = result.updatedInvoices ?? (result as any).invoicesUpdated ?? 0;
      const items = result.itemsUpdated ?? (result as any).updatedItems ?? 0;
      const aliases = result.aliasesConfigured ?? (result as any).aliases ?? 0;
      const message = `Naturezas consolidadas: ${invoices} notas, ${items} itens movidos, ${aliases} aliases configurados.`;
      setMergeFeedback(message);
      pushToast('success', message);

      await loadNaturezas(selectedCompanyId);
      clearSelection();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao consolidar naturezas.';
      setMergeFeedback(message);
      pushToast('error', message);
    } finally {
      setIsMerging(false);
    }
  }, [clearSelection, loadNaturezas, pushToast, selectedCompanyId, sourceNatOps, sourceNaturezaIds, targetId]);

  const applySavedFilter = useCallback(
    (filterId: string) => {
      const preset = savedFilters.find((f) => f.id === filterId);
      if (!preset) return;
      setFilterTerm(preset.term);
      setFilterType(preset.type);
      setOnlyLegacy(preset.onlyLegacy);
      setPage(1);
    },
    [savedFilters],
  );

  const saveCurrentFilter = useCallback(() => {
    const name = typeof window !== 'undefined' ? window.prompt('Nome do filtro para salvar?') : null;
    if (!name) return;
    const id = createToastId();
    setSavedFilters((prev) => [...prev, { id, name, term: filterTerm, type: filterType, onlyLegacy }]);
    pushToast('success', 'Filtro salvo.');
  }, [createToastId, filterTerm, filterType, onlyLegacy, pushToast]);

  const selectAllFilteredAsSources = useCallback(() => {
    setSourceNaturezaIds((prev) => {
      const next = new Set(prev);
      paginatedItems.forEach((item) => {
        if (item.naturezaOperacaoId && item.naturezaOperacaoId !== targetId) {
          next.add(item.naturezaOperacaoId);
        }
      });
      return next;
    });
    setSourceNatOps((prev) => {
      const next = new Set(prev);
      paginatedItems.forEach((item) => {
        if (!item.naturezaOperacaoId && item.natOp) {
          next.add(item.natOp.trim());
        }
      });
      return next;
    });
    pushToast('info', 'Itens do filtro marcados como origem.');
  }, [paginatedItems, pushToast, targetId]);

  const loadDetail = useCallback(
    async (naturezaId: string) => {
      if (!selectedCompanyId) return;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await fetchJson<{
          natureza: { includeInReports: boolean; descricao: string | null; natOp: string | null; cfopCode: string | null; cfopType: 'IN' | 'OUT' };
          aliases: Array<{ id: string; natOp: string; cfopCode: string | null; cfopType: 'IN' | 'OUT' }>;
          invoices: Array<{ id: string; chave: string; emissao: string | null; type: 'IN' | 'OUT'; totalNFe: string }>;
          products: Array<{ productId: string; product?: { name: string; sku: string | null }; invoiceItem?: { gross: string } }>;
        }>(`/companies/${selectedCompanyId}/naturezas/${naturezaId}/detail`);
        setDetailData(response);
        setAliasForm({ natOp: '', cfopCode: '', cfopType: 'OUT' });
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Falha ao carregar detalhes.');
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedCompanyId],
  );

  return (
    <div className="space-y-6 px-4 md:px-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Naturezas</p>
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Naturezas de Operação</h1>
          {selectedCompany ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Empresa: {selectedCompany.name}</p>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]/80">
              Selecione ou crie uma empresa para visualizar as naturezas importadas.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={clearSelection} size="sm">
            Limpar seleção
          </Button>
          <Button
            onClick={handleMerge}
            disabled={isMerging || !targetId || selectedSourcesCount === 0}
          >
            {isMerging ? 'Remapeando…' : 'Remapear naturezas'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const modal = document.getElementById('create-natureza');
              if (modal) modal.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Nova natureza
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] shadow-sm">
          <input
            value={filterTerm}
            onChange={(event) => setFilterTerm(event.target.value)}
            placeholder="Buscar por CFOP, descrição ou NatOp"
            className="w-full bg-transparent outline-none placeholder:text-[var(--color-text-secondary)]"
          />
        </div>
        <select
          value={filterType}
          onChange={(event) => setFilterType(event.target.value as 'ALL' | 'IN' | 'OUT')}
          className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
        >
          <option value="ALL">Entradas e saídas</option>
          <option value="IN">Somente entradas</option>
          <option value="OUT">Somente saídas</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <input
            type="checkbox"
            checked={onlyLegacy}
            onChange={(event) => setOnlyLegacy(event.target.checked)}
            className="h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
          />
          Somente linhas legadas (sem ID)
        </label>
      </div>

      {mergeFeedback && (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          {mergeFeedback}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-4 py-3 text-sm text-[var(--color-feedback-danger)]">
          {error}
        </div>
      )}

      {!selectedCompanyId ? (
        <div className="table-empty-state">Escolha uma empresa no topo para visualizar as naturezas importadas.</div>
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="table-empty-state">
          Nenhuma natureza encontrada. Faça upload de XMLs para populá-las automaticamente.
        </div>
      ) : (
        <div className="table-container">
          <div className="flex items-center justify-between gap-3 pb-2 text-xs text-[var(--color-text-secondary)]">
            <div className="flex items-center gap-2">
              <span>Mostrando {paginatedItems.length} de {sortedItems.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={selectAllFilteredAsSources}>
                Selecionar todas do filtro
              </Button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Destino</th>
                <th>Origem</th>
                <th>CFOP</th>
                <th>Natureza</th>
                <th>NatOp (bruto)</th>
                <th className="table-align-right">Notas</th>
                <th className="table-align-right">Itens</th>
                <th className="table-align-right">Total bruto</th>
                <th>Aliases</th>
                <th>Risco</th>
              </tr>
            </thead>
            <tbody className="text-xs text-[var(--color-text-secondary)]">
              {(['OUT', 'IN'] as Array<'OUT' | 'IN'>).map((group) => {
                const groupItems = paginatedItems.filter((item) => item.cfopType === group);
                if (!groupItems.length) return null;
                return (
                  <Fragment key={group}>
                    <tr className="bg-[var(--color-gray-50)]/70 text-[var(--color-text-primary)]">
                      <td colSpan={10} className="px-3 py-2 text-sm font-semibold">
                        {group === 'OUT' ? 'Saídas' : 'Entradas'} · {groupItems.length} linhas
                      </td>
                    </tr>
                    {groupItems.map((item) => {
                      const isTarget = targetId === item.naturezaOperacaoId;
                      const sourceChecked = isSourceChecked(item);
                      const disableTarget = item.isLegacy || !item.naturezaOperacaoId;
                      const hasRisk = !item.cfopCode || !item.natOp;
                      return (
                      <tr
                        key={item.naturezaKey + item.cfopType}
                        className={isTarget ? 'bg-[var(--color-brand-accent)]/10' : undefined}
                          onClick={() => {
                            setDetailItem(item);
                            if (item.naturezaOperacaoId) {
                              void loadDetail(item.naturezaOperacaoId);
                            } else {
                              setDetailData(null);
                            }
                          }}
                      >
                          <td className="table-align-center">
                            <input
                              type="radio"
                              name="target-natureza"
                              disabled={disableTarget}
                              checked={isTarget}
                              onChange={() => {
                                if (!item.naturezaOperacaoId) return;
                                setTargetId(item.naturezaOperacaoId);
                                setSourceNaturezaIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(item.naturezaOperacaoId!);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="table-align-center">
                            <input
                              type="checkbox"
                              disabled={item.naturezaOperacaoId === targetId}
                              checked={sourceChecked}
                              onChange={() => toggleSource(item)}
                            />
                          </td>
                          <td className="font-mono text-[0.75rem] text-[var(--color-text-primary)]">{item.cfopCode ?? '—'}</td>
                          <td className="text-[0.75rem] text-[var(--color-text-primary)]">
                            {item.naturezaOperacaoId ? (
                              <Link
                                href={`/app/naturezas/${item.naturezaOperacaoId}`}
                                className="font-semibold text-[var(--color-brand-secondary)] hover:underline"
                              >
                                {item.descricao || item.natOp || '—'}
                              </Link>
                            ) : (
                              item.descricao || '—'
                            )}
                          </td>
                          <td className="text-[0.75rem] text-[var(--color-text-secondary)]">{item.natOp || '—'}</td>
                          <td className="table-align-right">{item.invoiceCount}</td>
                          <td className="table-align-right">{item.itemCount}</td>
                          <td className="table-align-right text-[var(--color-brand-primary)]">{toCurrency(item.grossTotal)}</td>
                          <td className="space-y-2 text-[0.7rem] text-[var(--color-text-secondary)]">
                            <div className="flex flex-wrap gap-2">
                              {item.aliasNatOps?.length ? (
                                item.aliasNatOps.map((alias) => (
                                  <Badge key={alias} uppercase={false} variant="neutral" className="px-2 py-1 text-[0.65rem]">
                                    {alias}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-[var(--color-text-secondary)]/80">Nenhum alias cadastrado</span>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={!item.naturezaOperacaoId}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!item.naturezaOperacaoId) return;
                                setAliasModalTarget(item);
                              }}
                            >
                              Gerenciar aliases
                            </Button>
                          </td>
                          <td className="text-[0.7rem]">
                            {hasRisk ? (
                              <Badge variant="danger" uppercase={false}>
                                Falta CFOP ou NatOp
                              </Badge>
                            ) : (
                              <Badge variant="success" uppercase={false}>
                                OK
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Totais (filtro)</td>
                <td className="table-align-right">{formatNumber(naturezasTotals.invoices)}</td>
                <td className="table-align-right">{formatNumber(naturezasTotals.items)}</td>
                <td className="table-align-right">{toCurrency(naturezasTotals.total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Resumo do remapeamento</h2>
          <dl className="mt-3 grid grid-cols-4 gap-2 text-xs text-[var(--color-text-secondary)]">
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2">
              <dt className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]/80">Destino selecionado</dt>
              <dd className="mt-1 text-sm text-[var(--color-text-primary)]">
                {selectedTarget
                  ? `${selectedTarget.cfopCode ?? '—'} - ${selectedTarget.descricao ?? selectedTarget.natOp ?? '—'}`
                  : 'Nenhum'}
              </dd>
            </div>
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2">
              <dt className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]/80">Naturezas de origem</dt>
              <dd className="mt-1 text-sm text-[var(--color-text-primary)]">{selectedSourcesCount}</dd>
            </div>
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2">
              <dt className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]/80">Aliases cadastrados</dt>
              <dd className="mt-1 text-sm text-[var(--color-text-primary)]">{aliases.length}</dd>
            </div>
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2">
              <dt className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]/80">Observação</dt>
              <dd className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Naturezas sem ID (linhas legado) podem ser consolidadas marcando-as apenas como origem.
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={saveCurrentFilter}>
              Salvar filtros atuais
            </Button>
            {mergeFeedback ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => pushToast('info', 'Desfazer não suportado pela API.')}
              >
                Desfazer
              </Button>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-20">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Detalhe selecionado</h2>
          {detailItem ? (
            <div className="mt-2 space-y-3 text-xs text-[var(--color-text-secondary)]">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                {detailItem.descricao || detailItem.natOp || 'Sem descrição'}
              </p>
              <p>CFOP: {detailItem.cfopCode || '—'} · Tipo: {detailItem.cfopType === 'IN' ? 'Entrada' : 'Saída'}</p>
              <p>NatOp (bruto): {detailItem.natOp || '—'}</p>
              <p>Notas: {formatNumber(detailItem.invoiceCount)} · Itens: {formatNumber(detailItem.itemCount)}</p>
              <p>Total bruto: {toCurrency(detailItem.grossTotal)}</p>
              <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  checked={detailData?.natureza?.includeInReports ?? detailItem.includeInReports ?? true}
                  onChange={async (event) => {
                    if (!detailItem.naturezaOperacaoId) return;
                    try {
                      await fetchJson(`/companies/${selectedCompanyId}/naturezas/${detailItem.naturezaOperacaoId}/config`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ includeInReports: event.target.checked }),
                      });
                      setDetailData((prev) =>
                        prev ? { ...prev, natureza: { ...prev.natureza, includeInReports: event.target.checked } } : prev,
                      );
                      setItems((prev) =>
                        prev.map((item) =>
                          item.naturezaOperacaoId === detailItem.naturezaOperacaoId
                            ? { ...item, includeInReports: event.target.checked }
                            : item,
                        ),
                      );
                    } catch (err) {
                      pushToast('error', err instanceof Error ? err.message : 'Falha ao atualizar configuração.');
                    }
                  }}
                  className="h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
                />
                Incluir esta natureza em relatórios
              </label>

              <div className="space-y-1">
                <p className="font-semibold text-[var(--color-text-primary)]">Aliases</p>
                {detailLoading ? (
                  <span>Carregando...</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {detailData?.aliases?.length ? (
                      detailData.aliases.map((alias) => (
                        <span key={alias.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] px-2 py-1">
                          {alias.natOp} · {alias.cfopCode || '—'} ({alias.cfopType})
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await fetchJson(`/companies/${selectedCompanyId}/naturezas/${detailItem.naturezaOperacaoId}/aliases/${alias.id}`, {
                                  method: 'DELETE',
                                });
                                setDetailData((prev) =>
                                  prev
                                    ? { ...prev, aliases: (prev.aliases || []).filter((a) => a.id !== alias.id) }
                                    : prev,
                                );
                              } catch (err) {
                                pushToast('error', err instanceof Error ? err.message : 'Falha ao remover alias.');
                              }
                            }}
                            className="text-[var(--color-feedback-danger)]"
                            aria-label="Remover alias"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-[var(--color-text-secondary)]/80">Nenhum alias</span>
                    )}
                  </div>
                )}
                {detailItem.naturezaOperacaoId ? (
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      try {
                        await fetchJson(`/companies/${selectedCompanyId}/naturezas/${detailItem.naturezaOperacaoId}/aliases`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(aliasForm),
                        });
                        setAliasForm({ natOp: '', cfopCode: '', cfopType: 'OUT' });
                        await loadDetail(detailItem.naturezaOperacaoId);
                      } catch (err) {
                        pushToast('error', err instanceof Error ? err.message : 'Falha ao adicionar alias.');
                      }
                    }}
                  >
                    <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                      <span>NatOp</span>
                      <input
                        value={aliasForm.natOp}
                        onChange={(e) => setAliasForm((prev) => ({ ...prev, natOp: e.target.value }))}
                        className="h-8 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                        required
                      />
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                      <span>CFOP</span>
                      <input
                        value={aliasForm.cfopCode}
                        onChange={(e) => setAliasForm((prev) => ({ ...prev, cfopCode: e.target.value }))}
                        className="h-8 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                      />
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--color-text-primary)]">
                      <span>Tipo</span>
                      <select
                        value={aliasForm.cfopType}
                        onChange={(e) => setAliasForm((prev) => ({ ...prev, cfopType: e.target.value as 'IN' | 'OUT' }))}
                        className="h-8 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                      >
                        <option value="IN">Entrada</option>
                        <option value="OUT">Saída</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      className="rounded-md bg-[var(--color-brand-primary)] px-3 py-2 text-xs font-semibold text-white shadow-sm"
                    >
                      Adicionar alias
                    </button>
                  </form>
                ) : null}
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-[var(--color-text-primary)]">Produtos vinculados (amostra)</p>
                {detailData?.products?.length ? (
                  <ul className="space-y-1">
                    {detailData.products.map((p, idx) => (
                      <li key={`${p.productId ?? 'item'}-${idx}`} className="text-[var(--color-text-secondary)]">
                        {p.product?.name || 'Produto'} {p.product?.sku ? `· ${p.product.sku}` : ''} — Valor item: {toCurrency(p.invoiceItem?.gross ?? '0')}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[var(--color-text-secondary)]/80">Nenhum produto listado.</p>
                )}
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-[var(--color-text-primary)]">Notas fiscais (últimas 50)</p>
                {detailData?.invoices?.length ? (
                  <ul className="space-y-1">
                    {detailData.invoices.map((inv) => (
                      <li key={inv.id} className="text-[var(--color-text-secondary)]">
                        {inv.chave} · {inv.type} · {inv.emissao ? formatDate(inv.emissao) : '--'} · {formatCurrency(inv.totalNFe) ?? 'R$ --'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[var(--color-text-secondary)]/80">Nenhuma nota listada.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Clique em uma linha para ver detalhes.</p>
          )}
        </div>
      </section>

      <section id="create-natureza" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-4 shadow-sm">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Nova natureza manual</h2>
        <p className="text-xs text-[var(--color-text-secondary)]">Use para criar um destino padrão e consolidar naturezas do XML.</p>
        <form
          className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!selectedCompanyId) {
              pushToast('error', 'Selecione uma empresa.');
              return;
            }
            try {
              await fetchJson(`/companies/${selectedCompanyId}/naturezas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(createForm),
              });
              setCreateForm({ natOp: '', descricao: '', cfopCode: '', cfopType: 'OUT', includeInReports: true });
              await loadNaturezas(selectedCompanyId);
              pushToast('success', 'Natureza criada.');
            } catch (err) {
              pushToast('error', err instanceof Error ? err.message : 'Falha ao criar natureza.');
            }
          }}
        >
          <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
            <span className="font-semibold">NatOp</span>
            <input
              value={createForm.natOp}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, natOp: e.target.value }))}
              required
              className="h-10 rounded-md border border-[var(--color-border-subtle)] px-3 text-sm shadow-sm"
            />
          </label>
          <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
            <span className="font-semibold">Descrição</span>
            <input
              value={createForm.descricao}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, descricao: e.target.value }))}
              className="h-10 rounded-md border border-[var(--color-border-subtle)] px-3 text-sm shadow-sm"
            />
          </label>
          <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
            <span className="font-semibold">CFOP</span>
            <input
              value={createForm.cfopCode}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, cfopCode: e.target.value }))}
              required
              className="h-10 rounded-md border border-[var(--color-border-subtle)] px-3 text-sm shadow-sm"
            />
          </label>
          <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
            <span className="font-semibold">Tipo</span>
            <select
              value={createForm.cfopType}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, cfopType: e.target.value as 'IN' | 'OUT' }))}
              className="h-10 rounded-md border border-[var(--color-border-subtle)] px-3 text-sm shadow-sm"
            >
              <option value="IN">Entrada</option>
              <option value="OUT">Saída</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
            <input
              type="checkbox"
              checked={createForm.includeInReports}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, includeInReports: e.target.checked }))}
              className="h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
            />
            Incluir em relatórios
          </label>
          <div className="md:col-span-2 lg:col-span-3">
            <button
              type="submit"
              className="rounded-md bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
            >
              Criar natureza
            </button>
          </div>
        </form>
      </section>

      {savedFilters.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2 text-xs text-[var(--color-text-primary)]">
          <span className="font-semibold">Filtros salvos:</span>
          {savedFilters.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applySavedFilter(preset.id)}
              className="rounded-full border border-[var(--color-border-subtle)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
            >
              {preset.name} ({preset.type}, {preset.onlyLegacy ? 'legado' : 'todos'})
            </button>
          ))}
        </div>
      ) : null}
      <Modal
        open={Boolean(aliasModalTarget)}
        onClose={() => setAliasModalTarget(null)}
        size="lg"
        title={
          aliasModalTarget
            ? `Aliases para ${aliasModalTarget.descricao ?? aliasModalTarget.natOp ?? aliasModalTarget.cfopCode ?? 'Natureza'}`
            : 'Aliases'
        }
        description="Revise os aliases cadastrados para esta natureza. Ajustes devem refletir a identificação original nas notas."
        footer={
          <Button variant="ghost" onClick={() => setAliasModalTarget(null)}>
            Fechar
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
          {aliasModalTarget && !aliasModalTarget.naturezaOperacaoId ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Cadastre a natureza antes de adicionar aliases.
            </p>
          ) : null}
          {targetAliases.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                <tr>
                  <th className="pb-2">NatOp de origem</th>
                  <th className="pb-2">CFOP</th>
                  <th className="pb-2">Tipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {targetAliases.map((alias) => (
                  <tr key={alias.id} className="py-2 text-[var(--color-text-primary)]">
                    <td className="py-2 text-sm">{alias.natOp || '—'}</td>
                    <td className="py-2 font-mono text-sm tabular-nums">{alias.cfopCode}</td>
                    <td className="py-2 text-sm">{alias.cfopType === 'IN' ? 'Entrada' : 'Saída'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              Nenhum alias cadastrado para esta natureza até o momento.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
