'use client';

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Toast } from '@/ui/toast';
import { useCompanyContext } from '../_context/company-context';

type InvoiceRow = {
  id: string;
  chave: string;
  numero: string | null;
  type: 'IN' | 'OUT';
  emissao: string;
  issuerCnpj: string;
  recipientCnpj: string;
  totalNFe: string | null;
};

type InvoiceListResponse = {
  items: InvoiceRow[];
  nextCursor: string | null;
};

type InvoicePageData = InvoiceListResponse & { cursorUsed: string | null };

type InvoiceItem = {
  cfopCode: string | null;
  ncm: string | null;
  qty: string | null;
  unitPrice: string | null;
  gross: string | null;
  discount: string | null;
  icmsValue: string | null;
  ipiValue: string | null;
  pisValue: string | null;
  cofinsValue: string | null;
};

type InvoiceItemsResponse = {
  invoiceId: string;
  items: InvoiceItem[];
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

type Filters = {
  companyId: string;
  from: string;
  to: string;
  type: 'ALL' | 'IN' | 'OUT';
  search: string;
};

const CFOP_REPROCESS_ENABLED =
  String(process.env.NEXT_PUBLIC_CFOP_REPROCESS_ENABLE ?? 'false').toLowerCase() === 'true';

const PAGE_SIZE = 20;

type InvoicesPageContentProps = {
  initialCompanyId: string;
  fallbackCompanyId?: string;
  forceReprocess: boolean;
};

function InvoicesPageContent({ initialCompanyId, fallbackCompanyId, forceReprocess }: InvoicesPageContentProps) {
  const [filters, setFilters] = useState<Filters>({
    ...getDefaultFilters(),
    companyId: initialCompanyId,
  });
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(initialCompanyId || null);
  const [pages, setPages] = useState<InvoicePageData[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);
  const [itemRows, setItemRows] = useState<InvoiceItem[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [isItemsLoading, setItemsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isReprocessModalOpen, setReprocessModalOpen] = useState(false);
  const [reprocessMode, setReprocessMode] = useState<'dry-run' | 'commit'>('dry-run');
  const [reprocessOnlyMissing, setReprocessOnlyMissing] = useState(true);
  const [reprocessSince, setReprocessSince] = useState('');
  const [reprocessBatchSize, setReprocessBatchSize] = useState('500');
  const [reprocessIsSubmitting, setReprocessIsSubmitting] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const [reprocessResult, setReprocessResult] = useState<CfopReprocessSummary | null>(null);
  const [lastReprocessSummary, setLastReprocessSummary] = useState<CfopReprocessSummary | null>(null);
  const [forceReprocessConsumed, setForceReprocessConsumed] = useState(false);
  const [isActionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const createToastId = () =>
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));

  const showToast = (type: ToastMessage['type'], message: string) => {
    const id = createToastId();
    setToasts((prev) => [...prev, { id, type, message }]);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 5000);
    }
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  };

  useEffect(() => {
    if (!isActionsMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!actionsMenuRef.current) {
        return;
      }
      if (!actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActionsMenuOpen]);

  const currentPage = pages[pageIndex] ?? null;
  const isDrawerOpen = selectedInvoice != null;

  const normalizedFilterCompany = filters.companyId.trim();
  const fallbackCompanyCandidate = fallbackCompanyId ?? null;
  const targetCompanyId = (activeCompanyId
    || (normalizedFilterCompany ? normalizedFilterCompany : null)
    || fallbackCompanyCandidate
    || null) as string | null;
  const shouldRenderReprocessCTA = CFOP_REPROCESS_ENABLED && Boolean(targetCompanyId);
  const showReprocessBanner = shouldRenderReprocessCTA && !isReprocessModalOpen;
  const shouldRenderFallbackTools = shouldRenderReprocessCTA && !showReprocessBanner;
  const canTriggerReprocess = shouldRenderReprocessCTA;

  useEffect(() => {
    if (!shouldRenderReprocessCTA) {
      setActionsMenuOpen(false);
    }
  }, [shouldRenderReprocessCTA]);

  useEffect(() => {
    if (!forceReprocess || forceReprocessConsumed) {
      return;
    }
    if (!shouldRenderReprocessCTA) {
      return;
    }
    setReprocessModalOpen(true);
    setReprocessError(null);
    setForceReprocessConsumed(true);
  }, [forceReprocess, forceReprocessConsumed, shouldRenderReprocessCTA]);

  const handleFilterChange = <K extends keyof Filters>(field: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

const executeSearch = async (event?: FormEvent) => {
  event?.preventDefault();

  if (!filters.companyId.trim()) {
    setError('Informe o companyId para buscar.');
    return;
  }

    setIsLoading(true);
    setError(null);
    setSelectedInvoice(null);
    setItemsError(null);
    setItemRows([]);

    try {
      const { data, companyId } = await loadInvoices(null, filters);
      setPages([{ ...data, cursorUsed: null }]);
      setPageIndex(0);
      setActiveCompanyId(companyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao consultar notas.';
      setError(message);
      setPages([]);
      setActiveCompanyId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextPage = async () => {
    const page = pages[pageIndex];
    if (!page?.nextCursor) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, companyId } = await loadInvoices(page.nextCursor, filters, activeCompanyId);
      setActiveCompanyId(companyId);
      setPages((prev) => {
        const keep = prev.slice(0, pageIndex + 1);
        return [...keep, { ...data, cursorUsed: page.nextCursor }];
      });
      setPageIndex((prev) => prev + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao paginar notas.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrevPage = () => {
    setPageIndex((prev) => Math.max(0, prev - 1));
  };

  const openInvoice = async (invoice: InvoiceRow) => {
    if (!activeCompanyId) return;

    setSelectedInvoice(invoice);
    setItemsError(null);
    setItemsLoading(true);
    setItemRows([]);

    try {
      const payload = await fetchJson<InvoiceItemsResponse>(
        `/invoices/${invoice.id}/items?companyId=${encodeURIComponent(activeCompanyId)}`
      );
      setItemRows(payload.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar itens da nota.';
      setItemsError(message);
    } finally {
      setItemsLoading(false);
    }
  };

  const handleDeleteInvoice = async () => {
    if (!selectedInvoice || !activeCompanyId) return;
    const confirmDelete = typeof window !== 'undefined' ? window.confirm('Excluir esta nota fiscal? Esta ação não pode ser desfeita.') : true;
    if (!confirmDelete) return;
    setIsDeleting(true);
    try {
      await fetchJson(`/invoices/${selectedInvoice.id}?companyId=${encodeURIComponent(activeCompanyId)}`, {
        method: 'DELETE',
      });
      showToast('success', 'Nota excluída.');
      setSelectedInvoice(null);
      setItemRows([]);
      // Remove da página atual
      setPages((prev) =>
        prev.map((page) => ({
          ...page,
          items: page.items.filter((inv) => inv.id !== selectedInvoice.id),
        })),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao excluir nota.';
      showToast('error', message);
    } finally {
      setIsDeleting(false);
    }
  };

  const closeDrawer = () => {
    setSelectedInvoice(null);
    setItemRows([]);
    setItemsError(null);
    setItemsLoading(false);
  };

  const openReprocessModal = () => {
    if (!shouldRenderReprocessCTA) {
      setReprocessError('Selecione uma empresa para continuar.');
      showToast('error', 'Selecione uma empresa para reprocessar os CFOPs.');
      return;
    }
    setReprocessModalOpen(true);
    setReprocessError(null);
    setActionsMenuOpen(false);
    setForceReprocessConsumed(true);
  };

  const closeReprocessModal = () => {
    if (reprocessIsSubmitting) {
      return;
    }
    setReprocessModalOpen(false);
    setReprocessError(null);
  };

  const handleReprocess = async (modeToExecute: 'dry-run' | 'commit') => {
    if (!targetCompanyId) {
      setReprocessError('Selecione uma empresa para continuar.');
      showToast('error', 'Selecione uma empresa para reprocessar os CFOPs.');
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
        `/companies/${encodeURIComponent(targetCompanyId)}/reprocess-cfop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      setReprocessResult(summary);
      setLastReprocessSummary(summary);
      showToast(
        'success',
        summary.mode === 'commit'
          ? 'Reprocessamento concluído com sucesso.'
          : 'Dry-run concluído. Revise as amostras antes de executar.'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao reprocessar CFOPs.';
      setReprocessError(message);
      if (message.trim() === 'Recurso não disponível.') {
        showToast('error', 'Endpoint de reprocessamento desativado (CFOP_REPROCESS_ENABLE=false).');
      }
    } finally {
      setReprocessIsSubmitting(false);
    }
  };

  const hasResults = currentPage?.items?.length;

  const pageInfo = useMemo(() => {
    if (!pages.length) return null;
    return {
      start: pageIndex + 1,
      totalPages: pages.length,
    };
  }, [pageIndex, pages.length]);

  const pageTotalValue = useMemo(() => {
    if (!currentPage?.items?.length) return 0;
    return currentPage.items.reduce((acc, invoice) => {
      const value = invoice.totalNFe ? Number(invoice.totalNFe) : 0;
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0);
  }, [currentPage]);

  const formatDateTime = (value: string | null) => {
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
  };

  return (
    <div className="space-y-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {showReprocessBanner && (
        <section className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reprocessamento CFOP</p>
              <p className="text-sm text-slate-600">
                Atualiza o campo composto das notas desta empresa sem alterar valores fiscais ou direcionamento.
              </p>
            </div>
            <Button
              onClick={openReprocessModal}
              disabled={!canTriggerReprocess || reprocessIsSubmitting}
            >
              {reprocessIsSubmitting ? 'Processando…' : 'Reprocessar'}
            </Button>
          </div>
          {lastReprocessSummary && !isReprocessModalOpen && (
            <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">Último lote</span>
                <code className="rounded bg-white px-2 py-1 text-[0.7rem] text-slate-700">
                  {lastReprocessSummary.batchId}
                </code>
                <span>
                  {formatNumber(lastReprocessSummary.reprocessed)} de {formatNumber(lastReprocessSummary.scanned)} itens atualizados
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[0.7rem] text-slate-500">
                <span>Modo: {lastReprocessSummary.mode === 'commit' ? 'Execução' : 'Dry-run'}</span>
                <span>Concluído: {formatDateTime(lastReprocessSummary.finishedAt)}</span>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <form className="grid gap-3" onSubmit={executeSearch}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium">Empresa (companyId)</span>
              <input
                name="companyId"
                value={filters.companyId}
                onChange={(event) => handleFilterChange('companyId', event.target.value)}
                placeholder={fallbackCompanyId ? `ex: ${fallbackCompanyId}` : 'Informe o companyId'}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
              {fallbackCompanyId && fallbackCompanyId !== filters.companyId && (
                <button
                  type="button"
                  onClick={() => handleFilterChange('companyId', fallbackCompanyId)}
                  className="w-fit text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
                >
                  Usar empresa selecionada ({fallbackCompanyId})
                </button>
              )}
            </label>

            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium">Busca rápida</span>
              <input
                name="search"
                value={filters.search}
                onChange={(event) => handleFilterChange('search', event.target.value)}
                placeholder="Chave, número, CNPJ emitente/destinatário"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
              <span className="text-xs text-slate-500">Aceita partes da chave, número ou CNPJ (limpamos dígitos).</span>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Tipo</span>
              <div className="flex flex-wrap gap-2">
                {(['ALL', 'IN', 'OUT'] as Filters['type'][]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleFilterChange('type', t)}
                    className={`rounded-full border px-3 py-2 text-xs font-semibold ${
                      filters.type === t
                        ? 'border-slate-800 bg-white text-slate-900'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
                    }`}
                  >
                    {t === 'ALL' ? 'Todos' : t === 'IN' ? 'Entradas' : 'Saídas'}
                  </button>
                ))}
              </div>
            </div>

            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium">Data inicial</span>
              <input
                type="date"
                name="from"
                value={filters.from}
                onChange={(event) => handleFilterChange('from', event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium">Data final</span>
              <input
                type="date"
                name="to"
                value={filters.to}
                onChange={(event) => handleFilterChange('to', event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <div className="flex flex-col justify-end gap-2 text-xs text-slate-600">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:border-slate-500"
                  onClick={() => {
                    const today = new Date();
                    const start = new Date(today);
                    start.setDate(start.getDate() - 30);
                    handleFilterChange('from', start.toISOString().slice(0, 10));
                    handleFilterChange('to', today.toISOString().slice(0, 10));
                  }}
                >
                  Últimos 30 dias
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:border-slate-500"
                  onClick={() => {
                    handleFilterChange('from', '');
                    handleFilterChange('to', '');
                  }}
                >
                  Limpar datas
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Buscando…' : 'Buscar'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFilters(getDefaultFilters());
                setPages([]);
                setPageIndex(0);
                setActiveCompanyId(null);
                setError(null);
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </form>
        {shouldRenderFallbackTools && (
          <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ferramentas fiscais</p>
                <p className="text-xs text-slate-600">
                  Precisa reprocessar os CFOPs? Você também pode iniciar o fluxo por aqui.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={openReprocessModal}
                disabled={!canTriggerReprocess || reprocessIsSubmitting}
              >
                {reprocessIsSubmitting ? 'Processando…' : 'Reprocessar CFOPs'}
              </Button>
            </div>
          </div>
        )}
      </section>

      {CFOP_REPROCESS_ENABLED && isReprocessModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={closeReprocessModal}
        >
          <div
            className="w-full max-w-2xl rounded-lg bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reprocessar CFOPs</p>
                <h2 className="text-base font-semibold text-slate-900">Notas da empresa selecionada</h2>
                {targetCompanyId && (
                  <p className="text-xs text-slate-500">Empresa: {targetCompanyId}</p>
                )}
              </div>
              <button
                type="button"
                onClick={closeReprocessModal}
                disabled={reprocessIsSubmitting}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                Fechar
              </button>
            </header>

            <div className="space-y-5 px-6 py-6">
              <p className="text-sm text-slate-600">
                Este processo atualizará os CFOPs das notas desta empresa, derivando o formato{' '}
                <span className="font-mono">código + descrição</span>{' '}
                e registrando um lote de auditoria.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium">Data inicial (opcional)</span>
                  <input
                    type="date"
                    value={reprocessSince}
                    onChange={(event) => setReprocessSince(event.target.value)}
                    disabled={reprocessIsSubmitting}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                  <span className="text-xs text-slate-500">Reprocessa notas a partir desta data.</span>
                </label>

                <label className="grid gap-2 text-sm text-slate-700">
                  <span className="font-medium">Tamanho do lote</span>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={reprocessBatchSize}
                    onChange={(event) => setReprocessBatchSize(event.target.value)}
                    disabled={reprocessIsSubmitting}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                  <span className="text-xs text-slate-500">Default 500 itens por transação.</span>
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={reprocessOnlyMissing}
                  onChange={(event) => setReprocessOnlyMissing(event.target.checked)}
                  disabled={reprocessIsSubmitting}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-200 disabled:cursor-not-allowed"
                />
                <span>Reprocessar apenas onde o campo composto estiver ausente.</span>
              </label>

              {reprocessError && (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {reprocessError}
                </div>
              )}

              {reprocessIsSubmitting && (
                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-700">
                    Executando {reprocessMode === 'commit' ? 'commit' : 'dry-run'} em lotes de {reprocessBatchSize || '500'} itens
                  </p>
                  <div className="h-2 w-full rounded-full bg-slate-200">
                    <div className="h-2 w-1/2 animate-pulse rounded-full bg-slate-500/60" />
                  </div>
                  <p className="text-xs text-slate-500">Aguarde até o resumo final ser exibido.</p>
                </div>
              )}

              {reprocessResult && !reprocessIsSubmitting && (
                <div className="space-y-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-emerald-900">Resumo do lote</span>
                    <code className="rounded bg-emerald-100 px-2 py-1 text-[0.7rem] text-emerald-900">
                      {reprocessResult.batchId}
                    </code>
                    <span>
                      {reprocessResult.mode === 'commit' ? 'Execução' : 'Dry-run'} · {formatDateTime(reprocessResult.startedAt)} → {formatDateTime(reprocessResult.finishedAt)}
                    </span>
                  </div>

                  <ul className="grid gap-2 text-xs text-emerald-900 sm:grid-cols-2">
                    <li>Notas avaliadas: {formatNumber(reprocessResult.scanned)}</li>
                    <li>Itens atualizados: {formatNumber(reprocessResult.reprocessed)}</li>
                    <li>Itens sem alteração: {formatNumber(reprocessResult.skipped)}</li>
                    <li>Falhas: {formatNumber(reprocessResult.failed)}</li>
                  </ul>

                  {reprocessResult.samples.length > 0 && (
                    <div className="space-y-2 rounded-md border border-emerald-200 bg-white p-3 text-xs text-slate-700">
                      <p className="font-semibold text-slate-800">Amostras de alterações</p>
                      <div className="max-h-48 overflow-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-[0.7rem]">
                          <thead className="bg-slate-100 uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-2 py-2 font-medium">Nota</th>
                              <th className="px-2 py-2 font-medium">CFOP</th>
                              <th className="px-2 py-2 font-medium">Antes</th>
                              <th className="px-2 py-2 font-medium">Depois</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {reprocessResult.samples.map((sample) => (
                              <tr key={`${sample.invoiceId}-${sample.cfop ?? 'cfop'}`} className="bg-white">
                                <td className="px-2 py-2 font-mono text-[0.65rem] text-slate-700">{sample.invoiceId}</td>
                                <td className="px-2 py-2 font-mono text-[0.65rem] text-slate-700">{sample.cfop ?? '--'}</td>
                                <td className="px-2 py-2 text-[0.65rem] text-slate-600">{sample.oldComposite ?? '--'}</td>
                                <td className="px-2 py-2 text-[0.65rem] text-slate-600">{sample.newComposite ?? '--'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {reprocessResult.warnings.length > 0 && (
                    <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <p className="font-semibold">Avisos</p>
                      <ul className="list-disc space-y-1 pl-4">
                        {reprocessResult.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <footer className="flex flex-col gap-3 pt-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>Seguro e idempotente: valores fiscais permanecem inalterados.</span>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => handleReprocess('dry-run')}
                    disabled={reprocessIsSubmitting || !targetCompanyId}
                  >
                    Dry-run
                  </Button>
                  <Button
                    onClick={() => handleReprocess('commit')}
                    disabled={reprocessIsSubmitting || !targetCompanyId}
                  >
                    Executar
                  </Button>
                </div>
              </footer>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {hasResults ? (
        <section className="space-y-4">
          <div className="flex items-center justify-end">
            {shouldRenderReprocessCTA && (
              <div ref={actionsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setActionsMenuOpen((prev) => !prev)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-lg text-slate-600 shadow-sm transition hover:border-slate-500 hover:text-slate-900"
                  aria-label="Mais ações"
                >
                  ⋮
                </button>
                {isActionsMenuOpen && (
                  <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                    <button
                      type="button"
                      onClick={openReprocessModal}
                      className="block w-full px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      Reprocessar CFOPs
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th scope="col">Chave / Número</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Emissão</th>
                  <th scope="col">Emitente</th>
                  <th scope="col">Destinatário</th>
                  <th scope="col" className="table-align-right">Total NF-e</th>
                </tr>
              </thead>
              <tbody>
                {currentPage?.items.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="cursor-pointer"
                    onClick={() => openInvoice(invoice)}
                  >
                    <td className="font-mono text-xs text-[var(--color-text-primary)] break-all">
                      <div className="font-mono break-all">{invoice.chave}</div>
                      {invoice.numero ? <div className="text-[0.7rem] text-[var(--color-text-secondary)]">NF: {invoice.numero}</div> : null}
                    </td>
                    <td>
                      <Badge variant={invoice.type === 'IN' ? 'info' : 'neutral'} uppercase>
                        {invoice.type === 'IN' ? 'Entrada' : 'Saída'}
                      </Badge>
                    </td>
                    <td className="text-xs text-[var(--color-text-secondary)]">{formatDate(invoice.emissao)}</td>
                    <td className="text-xs text-[var(--color-text-secondary)] break-all">{invoice.issuerCnpj}</td>
                    <td className="text-xs text-[var(--color-text-secondary)] break-all">{invoice.recipientCnpj}</td>
                    <td className="table-align-right text-sm font-semibold text-[var(--color-brand-primary)]">
                      {formatCurrency(invoice.totalNFe)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total desta página</td>
                  <td className="table-align-right">{formatCurrency(pageTotalValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div>
              {pageInfo ? `Pagina ${pageInfo.start} de ${pageInfo.totalPages}` : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handlePrevPage} disabled={pageIndex === 0}>
                Anterior
              </Button>
              <Button size="sm" onClick={handleNextPage} disabled={!currentPage?.nextCursor || isLoading}>
                Próxima
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <div className="table-empty-state">
          {isLoading ? 'Consultando notas...' : 'Nenhuma nota carregada ainda.'}
        </div>
      )}

      {isDrawerOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Nota fiscal</p>
                <h2 className="text-base font-semibold text-slate-900">{selectedInvoice.chave}</h2>
                <p className="text-xs text-slate-500">
                  {formatDate(selectedInvoice.emissao)}
                  {selectedInvoice.numero ? ` · NF: ${selectedInvoice.numero}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:border-slate-500 hover:text-slate-900"
              >
                Fechar
              </button>
            </header>
            <div className="flex h-[calc(100%-64px)] flex-col overflow-hidden">
              <section className="grid gap-2 border-b border-slate-200 px-6 py-4 text-xs text-slate-600">
                <div><span className="font-semibold text-slate-700">Tipo:</span> {selectedInvoice.type}</div>
                <div><span className="font-semibold text-slate-700">Emitente:</span> {selectedInvoice.issuerCnpj}</div>
                <div><span className="font-semibold text-slate-700">Destinatario:</span> {selectedInvoice.recipientCnpj}</div>
                <div><span className="font-semibold text-slate-700">Total:</span> {formatCurrency(selectedInvoice.totalNFe)}</div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDeleteInvoice}
                    disabled={isDeleting}
                    className="bg-[var(--color-feedback-danger)]/10 text-[var(--color-feedback-danger)] hover:bg-[var(--color-feedback-danger)]/20"
                  >
                    {isDeleting ? 'Excluindo…' : 'Excluir nota'}
                  </Button>
                </div>
              </section>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {isItemsLoading && (
                  <p className="text-xs text-slate-500">Carregando itens...</p>
                )}
                {itemsError && (
                  <div
                    role="alert"
                    className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
                  >
                    {itemsError}
                  </div>
                )}
                {!isItemsLoading && !itemsError && itemRows.length === 0 && (
                  <p className="text-xs text-slate-500">Nenhum item para esta nota.</p>
                )}
                {!isItemsLoading && itemRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                      <thead className="bg-slate-100 text-[0.7rem] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">CFOP</th>
                          <th className="px-3 py-2 font-medium">NCM</th>
                          <th className="px-3 py-2 font-medium">Qtd</th>
                          <th className="px-3 py-2 font-medium">Unitario</th>
                          <th className="px-3 py-2 font-medium">Bruto</th>
                          <th className="px-3 py-2 font-medium">Impostos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {itemRows.map((item, index) => (
                          <tr key={`${item.cfopCode || 'cfop'}-${index}`} className="bg-white">
                            <td className="px-3 py-2 font-mono text-[0.7rem] text-slate-700">{item.cfopCode || '--'}</td>
                            <td className="px-3 py-2 font-mono text-[0.7rem] text-slate-700">{item.ncm || '--'}</td>
                            <td className="px-3 py-2 text-[0.7rem] text-slate-600">{item.qty || '--'}</td>
                            <td className="px-3 py-2 text-[0.7rem] text-slate-600">{item.unitPrice || '--'}</td>
                            <td className="px-3 py-2 text-[0.7rem] text-slate-600">{item.gross || '--'}</td>
                            <td className="px-3 py-2 text-[0.7rem] text-slate-600">
                              <div className="grid gap-1">
                                <span>ICMS: {item.icmsValue || '--'}</span>
                                <span>IPI: {item.ipiValue || '--'}</span>
                                <span>PIS: {item.pisValue || '--'}</span>
                                <span>COFINS: {item.cofinsValue || '--'}</span>
                                <span>Desconto: {item.discount || '--'}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoicesPageWithParams() {
  const searchParams = useSearchParams();
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const resolvedCompanyId = searchParams.get('companyId') ?? selectedCompanyId ?? '';
  const forceReprocess = searchParams.get('reprocess') === '1';

  return (
    <div className="space-y-6">
      {selectedCompany && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Empresa selecionada:</span>{' '}
          {selectedCompany.name} — <span className="font-mono">{selectedCompany.cnpj}</span>
        </div>
      )}
      <InvoicesPageContent
        key={resolvedCompanyId}
        initialCompanyId={resolvedCompanyId}
        fallbackCompanyId={selectedCompanyId ?? undefined}
        forceReprocess={forceReprocess}
      />
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense
      fallback={(
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          Carregando notas fiscais...
        </div>
      )}
    >
      <InvoicesPageWithParams />
    </Suspense>
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

async function loadInvoices(cursor: string | null, filters: Filters, fallbackCompanyId?: string | null) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
  });

  const companyId = filters.companyId.trim() || fallbackCompanyId || '';
  if (!companyId) {
    throw new Error('companyId nao informado.');
  }
  params.set('companyId', companyId);

  if (cursor) {
    params.set('cursor', cursor);
  }

  if (filters.from) {
    params.set('from', filters.from);
  }

  if (filters.to) {
    params.set('to', filters.to);
  }

  if (filters.type !== 'ALL') {
    params.set('type', filters.type);
  }

  if (filters.search.trim()) {
    params.set('search', filters.search.trim());
  }

  const search = params.toString();
  const data = await fetchJson<InvoiceListResponse>(`/invoices?${search}`);
  return { data, companyId };
}

function getDefaultFilters(): Filters {
  return {
    companyId: '',
    from: '',
    to: '',
    type: 'ALL',
    search: '',
  };
}
