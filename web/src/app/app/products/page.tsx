'use client';

import Link from 'next/link';
import type { ReactNode, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { fetchJson } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { useCompanyContext } from '../_context/company-context';

const STICKY_OFFSET = 72; // ajusta se o header global mudar de altura
const PAGE_SIZE_OPTIONS = [10, 20, 50];

type Product = {
  id: string;
  companyId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  ncm: string | null;
  description: string | null;
  type?: 'RAW' | 'FINISHED';
  _count?: { itemMappings?: number };
};

type ProductListResponse = {
  items: Product[];
  summary?: { total: number; mappedItems: number; unmappedItems: number };
};

type PreviewItem = {
  id: string;
  invoiceId: string;
  cfopCode: string | null;
  ncm: string | null;
  productCode: string | null;
  description: string | null;
  unit: string | null;
  qty: string;
  unitPrice: string;
  gross: string;
  productMapping: {
    product: { id: string; name: string } | null;
    notes: string | null;
  } | null;
  invoice: { emissao: string | null; type: 'IN' | 'OUT'; issuerCnpj: string; recipientCnpj: string; chave: string };
};

type PreviewResponse = { items: PreviewItem[] };

type MappingResponse = { item: { id: string } };

type ProductMappingRow = {
  id: string;
  conversionFactor: string | null;
  convertedQty: string | null;
  notes: string | null;
  createdAt?: string | null;
  invoiceItem: {
    id: string;
    qty: string | null;
    unit: string | null;
    gross: string | null;
    description: string | null;
    cfopCode: string | null;
    ncm: string | null;
    invoice: {
      id: string;
      chave: string;
      numero: string | null;
      emissao: string;
      type: 'IN' | 'OUT';
    };
  };
};

type ProductCompositionEntry = {
  id: string;
  companyId: string;
  rawProductId: string;
  finishedProductId: string;
  ratio: number | string;
  rawProduct: { id: string; name: string; unit: string | null; sku: string | null };
  finishedProduct: { id: string; name: string; unit: string | null; sku: string | null };
};

function formatCurrencySafe(value: number | null) {
  if (value == null) return 'R$ --';
  return formatCurrency(value) ?? 'R$ --';
}

function Badge({ tone, children }: { tone: 'neutral' | 'success' | 'warning' | 'info'; children: ReactNode }) {
  const tones: Record<typeof tone, string> = {
    neutral: 'border-[var(--color-border-subtle)] bg-[var(--color-gray-100)] text-[var(--color-text-secondary)]',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-sky-200 bg-sky-50 text-sky-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Drawer({
  open,
  title,
  onClose,
  children,
  placement = 'side',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  placement?: 'side' | 'center';
}) {
  const isSide = placement === 'side';
  return (
    <div className={`fixed inset-0 z-50 transition ${open ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={
          isSide
            ? `absolute right-0 top-0 h-full w-full max-w-2xl transform bg-[var(--color-surface-card)] shadow-2xl transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`
            : `absolute left-1/2 top-1/2 w-[94vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 transform rounded-xl bg-[var(--color-surface-card)] shadow-2xl transition ${open ? 'opacity-100' : 'opacity-0'}`
        }
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Painel</p>
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
            aria-label="Fechar painel"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className={isSide ? 'h-[calc(100%-72px)] overflow-y-auto px-5 py-4' : 'max-h-[80vh] overflow-y-auto px-5 py-4'}>{children}</div>
      </aside>
    </div>
  );
}

type DrawerState =
  | { open: false }
  | { open: true; type: 'product'; mode: 'create' | 'edit'; product?: Product }
  | { open: true; type: 'map'; item: PreviewItem };

type NewProductPayload = {
  name: string;
  sku?: string;
  unit?: string | null;
  ncm?: string | null;
  description?: string | null;
};

export default function ProductsPage() {
  const { selectedCompany, selectedCompanyId } = useCompanyContext();

  const [tab, setTab] = useState<'catalog' | 'queue' | 'compositions'>('catalog');

  const [products, setProducts] = useState<Product[]>([]);
  const [productsSummary, setProductsSummary] = useState({ total: 0, mappedItems: 0, unmappedItems: 0 });
  const [productsLoading, setProductsLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const [items, setItems] = useState<PreviewItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);

  const [compositions, setCompositions] = useState<ProductCompositionEntry[]>([]);
  const [compositionsLoading, setCompositionsLoading] = useState(false);
  const [compositionError, setCompositionError] = useState<string | null>(null);

  const [catalogFilters, setCatalogFilters] = useState<{ search: string; unit: string; mapped: 'ALL' | 'MAPPED' | 'UNMAPPED' }>({
    search: '',
    unit: 'ALL',
    mapped: 'ALL',
  });
  const [queueFilters, setQueueFilters] = useState<{ search: string; type: 'ALL' | 'IN' | 'OUT'; onlyUnmapped: boolean }>({
    search: '',
    type: 'ALL',
    onlyUnmapped: true,
  });

  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(20);

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [autoSummary, setAutoSummary] = useState<string | null>(null);
  const [autoUndoIds, setAutoUndoIds] = useState<string[]>([]);
  const [drawerState, setDrawerState] = useState<DrawerState>({ open: false });
  const [mapProductId, setMapProductId] = useState('');
  const [mapConvertedQty, setMapConvertedQty] = useState('');
  const [mapNotes, setMapNotes] = useState('');
  const [mapApplySimilar, setMapApplySimilar] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [mappings, setMappings] = useState<ProductMappingRow[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState<string | null>(null);
  const [editMappingId, setEditMappingId] = useState<string | null>(null);
  const [editConversionFactor, setEditConversionFactor] = useState('');
  const [editConvertedQty, setEditConvertedQty] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [isCreatingFromItem, setIsCreatingFromItem] = useState(false);

  const noCompany = !selectedCompanyId || !selectedCompany;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('auto-map-undo');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setAutoUndoIds(parsed.filter((id) => typeof id === 'string'));
        }
      } catch {
        // ignore parse errors
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (autoUndoIds.length) {
      window.localStorage.setItem('auto-map-undo', JSON.stringify(autoUndoIds));
    } else {
      window.localStorage.removeItem('auto-map-undo');
    }
  }, [autoUndoIds]);

  const sanitizeDecimal = useCallback((value: string | number | null | undefined) => {
    if (value == null) return '';
    const normalized = value.toString().replace(',', '.').trim();
    return normalized;
  }, []);

  const parseDecimal = useCallback(
    (value: string | null | undefined) => {
      if (!value) return null;
      const numeric = Number(sanitizeDecimal(value));
      return Number.isNaN(numeric) ? null : numeric;
    },
    [sanitizeDecimal],
  );

  const loadProductMappings = useCallback(
    async (companyId: string, productId: string) => {
      setMappingsLoading(true);
      setMappingsError(null);
      try {
        const response = await fetchJson<{ items: ProductMappingRow[] }>(
          `/companies/${companyId}/products/${productId}/mappings?limit=50`
        );
        setMappings(response.items || []);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao carregar conciliações do produto.';
        setMappingsError(message);
      } finally {
        setMappingsLoading(false);
      }
    },
    []
  );

  const loadProducts = useCallback(
    async (companyId: string) => {
      setProductsLoading(true);
      setProductError(null);
      try {
        const response = await fetchJson<ProductListResponse>(`/companies/${companyId}/products`);
        const itemsWithCounts = response.items.map((product) => ({
          ...product,
          _count: { itemMappings: product._count?.itemMappings ?? 0 },
        }));
        setProducts(itemsWithCounts);
        setProductsSummary(
          response.summary || {
            total: itemsWithCounts.length,
            mappedItems: itemsWithCounts.filter((p) => (p._count?.itemMappings ?? 0) > 0).length,
            unmappedItems: itemsWithCounts.filter((p) => (p._count?.itemMappings ?? 0) === 0).length,
          },
        );
        if (!selectedProductId && itemsWithCounts.length) {
          setSelectedProductId(itemsWithCounts[0].id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao carregar produtos.';
        setProductError(message);
      } finally {
        setProductsLoading(false);
      }
    },
    [selectedProductId],
  );

  const loadItems = useCallback(
    async (companyId: string) => {
      setItemsLoading(true);
      setItemError(null);
      try {
        const response = await fetchJson<PreviewResponse>(`/companies/${companyId}/products/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            search: queueFilters.search,
            type: queueFilters.type,
            mapped: queueFilters.onlyUnmapped ? false : undefined,
          }),
        });
        setItems(response.items);
        if (!selectedItemId && response.items.length) {
          setSelectedItemId(response.items[0].id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao carregar fila.';
        setItemError(message);
      } finally {
        setItemsLoading(false);
      }
    },
    [queueFilters.onlyUnmapped, queueFilters.search, queueFilters.type, selectedItemId],
  );

  const loadCompositions = useCallback(async (companyId: string) => {
    setCompositionsLoading(true);
    setCompositionError(null);
    try {
      const response = await fetchJson<{ items: ProductCompositionEntry[] }>(`/products/${companyId}/compositions`);
      setCompositions(response.items);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao carregar composições.';
      setCompositionError(message);
    } finally {
      setCompositionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) {
      setProducts([]);
      setItems([]);
      setCompositions([]);
      setMappings([]);
      setSelectedProductId(null);
      setSelectedItemId(null);
      return;
    }
    void loadProducts(selectedCompanyId);
    void loadItems(selectedCompanyId);
    void loadCompositions(selectedCompanyId);
  }, [loadCompositions, loadItems, loadProducts, selectedCompanyId]);

  useEffect(() => {
    if (selectedProductId && selectedCompanyId) {
      void loadProductMappings(selectedCompanyId, selectedProductId);
    } else {
      setMappings([]);
    }
  }, [loadProductMappings, selectedCompanyId, selectedProductId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    void loadItems(selectedCompanyId);
  }, [loadItems, selectedCompanyId, queueFilters]);

  useEffect(() => {
    if (drawerState.open && drawerState.type === 'map') {
      const current = drawerState.item;
      setMapProductId(current.productMapping?.product?.id || '');
      setMapConvertedQty(sanitizeDecimal(current.productMapping?.convertedQty ?? current.qty));
      setMapNotes(current.productMapping?.notes || '');
      setMapApplySimilar(true);
    }
  }, [drawerState, sanitizeDecimal]);

  const units = useMemo(() => {
    const set = new Set<string>();
    products.forEach((product) => {
      if (product.unit && product.unit.trim()) set.add(product.unit.trim());
    });
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = catalogFilters.search.trim().toLowerCase();
    const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));
    return sorted.filter((product) => {
      const matchesTerm = term
        ? [product.name, product.sku, product.ncm, product.description].filter(Boolean).some((value) => value?.toString().toLowerCase().includes(term))
        : true;
      const matchesUnit = catalogFilters.unit === 'ALL' ? true : (product.unit || '').toLowerCase() === catalogFilters.unit.toLowerCase();
      const mappedCount = product._count?.itemMappings ?? 0;
      const matchesMapped =
        catalogFilters.mapped === 'ALL' ? true : catalogFilters.mapped === 'MAPPED' ? mappedCount > 0 : mappedCount === 0;
      return matchesTerm && matchesUnit && matchesMapped;
    });
  }, [catalogFilters.mapped, catalogFilters.search, catalogFilters.unit, products]);

  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / catalogPageSize));
  const paginatedProducts = useMemo(() => {
    const start = (catalogPage - 1) * catalogPageSize;
    return filteredProducts.slice(start, start + catalogPageSize);
  }, [catalogPage, catalogPageSize, filteredProducts]);

  const selectedProduct = useMemo(
    () => paginatedProducts.find((p) => p.id === selectedProductId) || products.find((p) => p.id === selectedProductId) || null,
    [paginatedProducts, products, selectedProductId],
  );
  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) || null, [items, selectedItemId]);
  const activeMapProduct = useMemo(() => products.find((product) => product.id === mapProductId) || null, [mapProductId, products]);
  const suggestedProducts = useMemo(() => {
    if (!selectedItem) return [];
    const term = (selectedItem.description || selectedItem.productCode || '').toLowerCase();
    const ncm = selectedItem.ncm?.trim();
    if (!term && !ncm) return [];
    return products
      .filter((product) => {
        const haystack = `${product.name} ${product.sku ?? ''} ${product.description ?? ''}`.toLowerCase();
        const matchText = term ? haystack.includes(term.slice(0, 12)) || haystack.includes(term.split(' ')[0] ?? '') : false;
        const matchNcm = ncm ? product.ncm?.toLowerCase() === ncm.toLowerCase() : false;
        return matchText || matchNcm;
      })
      .slice(0, 5);
  }, [products, selectedItem]);

  const handleAutoMap = async () => {
    if (!selectedCompanyId) return;
    setAutoSummary('Conciliando itens automaticamente...');
    setAutoUndoIds([]);
    setFeedback(null);
    try {
      const response = await fetchJson<{ mapped: number; skipped: number; total: number; undo?: { invoiceItemIds?: string[] } }>(`/companies/${selectedCompanyId}/products/auto-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setAutoSummary(`Vinculados ${response.mapped}; ${response.skipped} pendentes de ${response.total}.`);
      setAutoUndoIds(response.undo?.invoiceItemIds ?? []);
      setFeedback({ type: 'success', message: 'Conciliação automática concluída.' });
      await loadProducts(selectedCompanyId);
      await loadItems(selectedCompanyId);
      await loadCompositions(selectedCompanyId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao auto-mapear.';
      setAutoSummary(message);
      setAutoUndoIds([]);
      setFeedback({ type: 'error', message });
    }
  };

  const handleUndoAutoMap = async () => {
    if (!selectedCompanyId || !autoUndoIds.length) return;
    setFeedback(null);
    try {
      const result = await fetchJson<{ undone: number }>(`/companies/${selectedCompanyId}/products/auto-map/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceItemIds: autoUndoIds }),
      });
      setFeedback({ type: 'success', message: `Conciliação desfeita para ${result.undone} itens.` });
      setAutoUndoIds([]);
      await loadProducts(selectedCompanyId);
      await loadItems(selectedCompanyId);
      await loadCompositions(selectedCompanyId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao desfazer conciliação.';
      setFeedback({ type: 'error', message });
    }
  };

  const handleSaveProduct = async (event: FormEvent<HTMLFormElement>, opts: { id?: string }) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: (formData.get('name') as string).trim(),
      sku: ((formData.get('sku') as string) || '').trim() || undefined,
      unit: ((formData.get('unit') as string) || '').trim() || undefined,
      ncm: ((formData.get('ncm') as string) || '').trim() || undefined,
      description: ((formData.get('description') as string) || '').trim() || undefined,
    };
    if (!payload.name) {
      setProductError('Informe um nome.');
      return;
    }
    try {
      if (opts.id) {
        await fetchJson(`/companies/${selectedCompanyId}/products/${opts.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJson(`/companies/${selectedCompanyId}/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      setDrawerState({ open: false });
      setFeedback({ type: 'success', message: 'Produto salvo com sucesso.' });
      await loadProducts(selectedCompanyId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar.';
      setProductError(message);
      setFeedback({ type: 'error', message });
    }
  };

  const handleCreateProductFromItem = useCallback(
    async (item: PreviewItem) => {
      if (!selectedCompanyId) return;
      setIsCreatingFromItem(true);
      try {
        const payload: NewProductPayload = {
          name: item.description || item.productCode || 'Produto importado',
          sku: item.productCode || undefined,
          unit: item.unit || undefined,
          ncm: item.ncm || undefined,
          description: item.description || undefined,
        };
        const product = await fetchJson<Product>(`/companies/${selectedCompanyId}/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setProducts((prev) => [product, ...prev]);
        setMapProductId(product.id);
        setSelectedProductId(product.id);
        setCatalogPage(1);
        setFeedback({ type: 'success', message: 'Produto criado a partir do item importado.' });
        await loadProducts(selectedCompanyId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao criar produto.';
        setFeedback({ type: 'error', message });
      } finally {
        setIsCreatingFromItem(false);
      }
    },
    [loadProducts, selectedCompanyId],
  );

  const handleDeleteProduct = async (productId: string) => {
    if (!selectedCompanyId) return;
    if (!confirm('Excluir produto? Esta ação não pode ser desfeita.')) return;
    try {
      await fetchJson(`/companies/${selectedCompanyId}/products/${productId}`, { method: 'DELETE' });
      await loadProducts(selectedCompanyId);
      setFeedback({ type: 'success', message: 'Produto excluído.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao excluir.';
      setProductError(message);
      setFeedback({ type: 'error', message });
    }
  };

  const startEditMapping = (row: ProductMappingRow) => {
    setEditMappingId(row.id);
    setEditConversionFactor(row.conversionFactor ?? '');
    setEditConvertedQty(row.convertedQty ?? row.invoiceItem.qty ?? '');
    setEditNotes(row.notes ?? '');
  };

  const cancelEditMapping = () => {
    setEditMappingId(null);
    setEditConversionFactor('');
    setEditConvertedQty('');
    setEditNotes('');
  };

  const saveEditMapping = async () => {
    if (!editMappingId || !selectedCompanyId || !selectedProductId) return;
    setIsSavingMapping(true);
    try {
      await fetchJson(`/companies/${selectedCompanyId}/products/${selectedProductId}/mappings/${editMappingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversionFactor: editConversionFactor || null,
          convertedQty: editConvertedQty || null,
          notes: editNotes || null,
        }),
      });
      setFeedback({ type: 'success', message: 'Conciliação atualizada.' });
      setEditMappingId(null);
      await loadProductMappings(selectedCompanyId, selectedProductId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar conciliação.';
      setProductError(message);
      setFeedback({ type: 'error', message });
    } finally {
      setIsSavingMapping(false);
    }
  };

  const handleMapItem = async (
    event: FormEvent<HTMLFormElement>,
    item: PreviewItem,
    overrides?: { productId?: string; notes?: string; convertedQty?: string; applySimilar?: boolean },
  ) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    const formData = new FormData(event.currentTarget);
    const productId = overrides?.productId ?? (formData.get('productId') as string) ?? '';
    const notes = overrides?.notes ?? ((formData.get('notes') as string) || '');
    const applySimilar = overrides?.applySimilar ?? formData.get('applySimilar') === 'on';
    const converted = sanitizeDecimal(overrides?.convertedQty ?? ((formData.get('convertedQty') as string) || ''));
    const convertedNumber = parseDecimal(converted);
    if (!productId) {
      setItemError('Selecione um produto.');
      return;
    }
    if (!convertedNumber || convertedNumber <= 0) {
      setItemError('Quantidade convertida inválida.');
      return;
    }
    const normalize = (value: string | null) => (value ? value.trim().toLowerCase() : '');
    const mappedDescKey = `${normalize(item.description || item.productCode)}|${normalize(item.unit)}`;

    try {
      await fetchJson<MappingResponse>(`/companies/${selectedCompanyId}/products/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceItemId: item.id,
          productId,
          convertedQty: converted,
          notes: notes || undefined,
          applySimilar,
        }),
      });
      setDrawerState({ open: false });

      // Remover da fila localmente (o próprio item e similares, se solicitado)
      setItems((prev) => {
        const filtered = prev.filter((candidate) => {
          if (candidate.id === item.id) return false;
          if (!applySimilar) return true;
          const key = `${normalize(candidate.description || candidate.productCode)}|${normalize(candidate.unit)}`;
          return key !== mappedDescKey;
        });
        setSelectedItemId((current) => {
          if (current && filtered.some((candidate) => candidate.id === current)) return current;
          return filtered[0]?.id ?? null;
        });
        return filtered;
      });

      // Atualizar catálogo/contagens
      await loadProducts(selectedCompanyId);
      setFeedback({ type: 'success', message: 'Item mapeado.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao mapear item.';
      setItemError(message);
      setFeedback({ type: 'error', message });
    }
  };

  const handleCreateComposition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    const formData = new FormData(event.currentTarget);
    const raw = (formData.get('raw') as string) || '';
    const finished = (formData.get('finished') as string) || '';
    const ratio = sanitizeDecimal((formData.get('ratio') as string) || '');
    if (!raw || !finished || raw === finished || !ratio) {
      setCompositionError('Preencha matéria-prima, produto acabado diferentes e uma relação válida.');
      return;
    }
    try {
      await fetchJson(`/products/${selectedCompanyId}/compositions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawProductId: raw, finishedProductId: finished, ratio }),
      });
      await loadCompositions(selectedCompanyId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao criar composição.';
      setCompositionError(message);
    }
  };

  const topMetrics = [
    { label: 'Catálogo', value: productsSummary.total || products.length },
    { label: 'Mapeados', value: productsSummary.mappedItems },
    { label: 'Pendentes', value: productsSummary.unmappedItems },
    { label: 'Fila', value: items.length },
  ];

  const renderCatalogTable = () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border-subtle)] px-1 pb-2">
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="h-4 w-4 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <input
            value={catalogFilters.search}
            onChange={(event) => {
              setCatalogFilters((prev) => ({ ...prev, search: event.target.value }));
              setCatalogPage(1);
            }}
            placeholder="Buscar por nome, SKU, NCM ou descrição"
            className="w-full bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
          />
        </div>
        <select
          value={catalogFilters.unit}
          onChange={(event) => {
            setCatalogFilters((prev) => ({ ...prev, unit: event.target.value }));
            setCatalogPage(1);
          }}
          className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
        >
          <option value="ALL">Unidades</option>
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
        <select
          value={catalogFilters.mapped}
          onChange={(event) => {
            setCatalogFilters((prev) => ({ ...prev, mapped: event.target.value as 'ALL' | 'MAPPED' | 'UNMAPPED' }));
            setCatalogPage(1);
          }}
          className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
        >
          <option value="ALL">Status</option>
          <option value="MAPPED">Mapeados</option>
          <option value="UNMAPPED">Pendentes</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setCatalogFilters({ search: '', unit: 'ALL', mapped: 'ALL' });
            setCatalogPage(1);
          }}
          className="text-xs font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
        >
          Limpar
        </button>
        <div className="flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-white px-2 py-1 text-xs text-[var(--color-text-secondary)]">
          <select
            value={catalogPageSize}
            onChange={(event) => {
              const size = Number(event.target.value);
              setCatalogPageSize(size);
              setCatalogPage(1);
            }}
            className="rounded border border-[var(--color-border-subtle)] bg-white px-2 py-1"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}/página
              </option>
            ))}
          </select>
          <span className="px-2 text-[var(--color-text-secondary)]">
            Página {catalogPage} / {totalProductPages}
          </span>
          <button
            type="button"
            disabled={catalogPage <= 1}
            onClick={() => setCatalogPage((prev) => Math.max(1, prev - 1))}
            className="rounded border border-[var(--color-border-subtle)] px-2 disabled:opacity-50"
          >
            ‹
          </button>
          <button
            type="button"
            disabled={catalogPage >= totalProductPages}
            onClick={() => setCatalogPage((prev) => Math.min(totalProductPages, prev + 1))}
            className="rounded border border-[var(--color-border-subtle)] px-2 disabled:opacity-50"
          >
            ›
          </button>
        </div>
      </div>

      <div className="border-t border-b border-[var(--color-border-subtle)]">
        {productsLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="h-12 animate-pulse rounded-lg bg-[var(--color-gray-100)]/80" />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="space-y-3 p-6 text-center text-sm text-[var(--color-text-secondary)]">
            <p>Nenhum produto encontrado.</p>
            <div className="flex justify-center gap-4 text-xs font-semibold text-[var(--color-brand-secondary)]">
              <Link href="/app/upload" className="underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline">
                Importar XML
              </Link>
              <button
                type="button"
                onClick={() => setDrawerState({ open: true, mode: 'create', type: 'product' })}
                className="underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
              >
                Criar produto
              </button>
            </div>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[1040px] table-auto divide-y divide-[var(--color-border-subtle)] text-left text-sm">
              <thead className="sticky top-0 bg-[var(--color-gray-50)] text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th className="sticky left-0 z-10 bg-[var(--color-gray-50)] px-3 py-2 min-w-[360px]">Produto</th>
                  <th className="px-3 py-2 min-w-[120px]">Unidade</th>
                  <th className="px-3 py-2 min-w-[120px]">NCM</th>
                  <th className="px-3 py-2 min-w-[140px]">Tipo</th>
                  <th className="px-3 py-2 min-w-[140px] text-right">Status</th>
                  <th className="px-3 py-2 min-w-[160px] text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {paginatedProducts.map((product, index) => {
                  const mappedCount = product._count?.itemMappings ?? 0;
                  const typeBadge =
                    product.type === 'FINISHED' ? (
                      <Badge tone="info">Produto acabado</Badge>
                    ) : product.type === 'RAW' ? (
                      <Badge tone="warning">Matéria-prima</Badge>
                    ) : (
                      <Badge tone="neutral">Tipo não informado</Badge>
                    );
                  const statusBadge = mappedCount > 0 ? <Badge tone="success">Mapeado</Badge> : <Badge tone="warning">Pendente</Badge>;
                  const isSelected = selectedProductId === product.id;
                  return (
                    <tr
                      key={`${product.id}-${index}`}
                      className={`${index % 2 === 0 ? 'bg-[var(--color-surface-card)]' : 'bg-[var(--color-gray-50)]'} ${isSelected ? 'outline outline-2 outline-[var(--color-brand-primary)]/40' : ''}`}
                      onClick={() => setSelectedProductId(product.id)}
                    >
                      <td className="sticky left-0 z-10 bg-inherit px-3 py-3 align-top text-sm text-[var(--color-text-primary)]">
                        <div className="font-semibold leading-tight">{product.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                          <span className="rounded-full bg-[var(--color-gray-100)] px-2 py-0.5 font-semibold">SKU {product.sku || '—'}</span>
                        </div>
                        {product.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-secondary)]" title={product.description}>
                            {product.description}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">{product.unit || '—'}</td>
                      <td className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">{product.ncm || '—'}</td>
                      <td className="px-3 py-3 text-sm">{typeBadge}</td>
                      <td className="px-3 py-3 text-right text-sm">
                        <div className="flex items-center justify-end gap-2">
                          {statusBadge}
                          {mappedCount > 0 ? (
                            <span className="rounded-full bg-[var(--color-gray-100)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--color-text-secondary)]">
                              {mappedCount}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-sm">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDrawerState({ open: true, mode: 'edit', type: 'product', product });
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-xs font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteProduct(product.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-feedback-danger)] px-2 py-1 text-xs font-semibold text-[var(--color-feedback-danger)] hover:bg-[var(--color-feedback-danger)]/10 focus-visible:outline-focus-visible"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderCatalogDetail = () => {
    if (!selectedProduct) {
      return <div className="flex h-full min-h-[340px] items-center justify-center text-sm text-[var(--color-text-secondary)]">Selecione um produto para ver detalhes.</div>;
    }
    const mappedCount = selectedProduct._count?.itemMappings ?? 0;
    return (
      <div className="space-y-4 border-t border-[var(--color-border-subtle)] pt-4">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Produto</p>
          <h3 className="text-xl font-semibold text-[var(--color-text-primary)]">{selectedProduct.name}</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            SKU {selectedProduct.sku || '—'} · Unidade {selectedProduct.unit || '—'} · NCM {selectedProduct.ncm || '—'}
          </p>
        </header>
        {selectedProduct.description ? <p className="text-sm text-[var(--color-text-secondary)]">{selectedProduct.description}</p> : null}
        <div className="flex flex-wrap gap-2 text-xs">
          {selectedProduct.type ? (
            <Badge tone={selectedProduct.type === 'FINISHED' ? 'info' : 'warning'}>
              {selectedProduct.type === 'FINISHED' ? 'Produto acabado' : 'Matéria-prima'}
            </Badge>
          ) : null}
          <Badge tone={mappedCount > 0 ? 'success' : 'warning'}>{mappedCount > 0 ? `${mappedCount} mapeado(s)` : 'Pendente de mapeamento'}</Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            onClick={() => setDrawerState({ open: true, mode: 'edit', type: 'product', product: selectedProduct })}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] px-3 py-2 font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
          >
            Editar produto
          </button>
          <Link
            href="/app/upload"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] px-3 py-2 font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
          >
            Importar XML para mapear
          </Link>
        </div>

        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">Conciliações</p>
              <p className="text-sm text-[var(--color-text-secondary)]">Valores originais vs. convertidos para este produto.</p>
            </div>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {mappingsLoading ? 'Carregando…' : `${mappings.length} registro(s)`}
            </span>
          </div>
          {mappingsError ? (
            <div className="mt-3 rounded-md border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-xs text-[var(--color-feedback-danger)]">
              {mappingsError}
            </div>
          ) : null}
          {mappingsLoading ? (
            <div className="mt-3 space-y-2">
              {[1, 2, 3].map((row) => (
                <div key={row} className="h-10 animate-pulse rounded-md bg-[var(--color-gray-100)]" />
              ))}
            </div>
          ) : mappings.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">Nenhuma conciliação para este produto.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-xs">
                <thead className="bg-[var(--color-gray-50)] text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  <tr>
                    <th className="px-2 py-2">Nota</th>
                    <th className="px-2 py-2">Data</th>
                    <th className="px-2 py-2">CFOP</th>
                    <th className="px-2 py-2">Original</th>
                    <th className="px-2 py-2">Convertido</th>
                    <th className="px-2 py-2">Fator</th>
                    <th className="px-2 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {mappings.map((row) => {
                    const isEditing = editMappingId === row.id;
                    const origQty = row.invoiceItem.qty ?? '';
                    const origUnit = row.invoiceItem.unit ?? '';
                    const origGross = row.invoiceItem.gross ?? '';
                    return (
                      <tr key={row.id} className="bg-white align-top">
                        <td className="px-2 py-2">
                          <div className="font-mono text-[0.7rem] text-[var(--color-text-primary)] break-all">
                            {row.invoiceItem.invoice.chave}
                          </div>
                          <div className="text-[0.65rem] text-[var(--color-text-secondary)]">
                            {row.invoiceItem.invoice.numero ? `NF ${row.invoiceItem.invoice.numero} · ` : ''}
                            {row.invoiceItem.invoice.type === 'IN' ? 'Entrada' : 'Saída'}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-[var(--color-text-secondary)]">{formatDate(row.invoiceItem.invoice.emissao)}</td>
                        <td className="px-2 py-2 font-mono text-[0.75rem] text-[var(--color-text-primary)]">{row.invoiceItem.cfopCode || '—'}</td>
                        <td className="px-2 py-2 text-[var(--color-text-secondary)]">
                          <div>{row.invoiceItem.description || 'Item da NF'}</div>
                          <div className="text-[0.7rem] text-[var(--color-text-primary)]">
                            {origQty} {origUnit} · {formatCurrencySafe(origGross ? Number(origGross) : null)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-[var(--color-text-primary)]">
                          {isEditing ? (
                            <input
                              className="h-9 w-28 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                              value={editConvertedQty}
                              onChange={(e) => setEditConvertedQty(e.target.value)}
                            />
                          ) : (
                            <span className="font-semibold">{row.convertedQty ?? origQty}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-[var(--color-text-primary)]">
                          {isEditing ? (
                            <input
                              className="h-9 w-24 rounded-md border border-[var(--color-border-subtle)] px-2 text-sm"
                              value={editConversionFactor}
                              onChange={(e) => setEditConversionFactor(e.target.value)}
                              placeholder="Fator"
                            />
                          ) : (
                            <span className="font-mono text-[0.8rem]">{row.conversionFactor ?? '1.0'}</span>
                          )}
                          {isEditing ? (
                            <textarea
                              className="mt-1 w-full rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-sm"
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder="Anotações"
                            />
                          ) : row.notes ? (
                            <div className="text-[0.7rem] text-[var(--color-text-secondary)]">{row.notes}</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          {isEditing ? (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={saveEditMapping} disabled={isSavingMapping}>
                                {isSavingMapping ? 'Salvando…' : 'Salvar'}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEditMapping}>
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => startEditMapping(row)}>
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderQueueTable = () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border-subtle)] px-1 pb-2">
        <div className="flex min-w-[260px] flex-1 items-center gap-2">
          <Search className="h-4 w-4 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <input
            value={queueFilters.search}
            onChange={(event) => setQueueFilters((prev) => ({ ...prev, search: event.target.value }))}
            placeholder="Buscar itens da fila"
            className="w-full bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
          />
        </div>
        <select
          value={queueFilters.type}
          onChange={(event) => setQueueFilters((prev) => ({ ...prev, type: event.target.value as 'ALL' | 'IN' | 'OUT' }))}
          className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
        >
          <option value="ALL">Tipo</option>
          <option value="IN">Entrada</option>
          <option value="OUT">Saída</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
          <input
            type="checkbox"
            checked={queueFilters.onlyUnmapped}
            onChange={(event) => setQueueFilters((prev) => ({ ...prev, onlyUnmapped: event.target.checked }))}
            className="h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
          />
          Só não mapeados
        </label>
        <button
          type="button"
          onClick={() => setQueueFilters({ search: '', type: 'ALL', onlyUnmapped: true })}
          className="text-xs font-semibold text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
        >
          Limpar
        </button>
      </div>

      <div className="border-t border-b border-[var(--color-border-subtle)]">
        {itemsLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="h-14 animate-pulse rounded-lg bg-[var(--color-gray-100)]/80" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="space-y-3 p-6 text-center text-sm text-[var(--color-text-secondary)]">
            <p>Nenhum item na fila para o filtro atual.</p>
            <div className="flex justify-center gap-4 text-xs font-semibold text-[var(--color-brand-secondary)]">
              <Link href="/app/upload" className="underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline">
                Importar XML
              </Link>
              <button
                type="button"
                onClick={() => setDrawerState({ open: true, mode: 'create', type: 'product' })}
                className="underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
              >
                Criar produto
              </button>
            </div>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[960px] table-auto divide-y divide-[var(--color-border-subtle)] text-left text-sm">
              <thead className="sticky top-0 bg-[var(--color-gray-50)] text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th className="sticky left-0 z-10 bg-[var(--color-gray-50)] px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">CFOP</th>
                  <th className="px-3 py-2">Unidade</th>
                  <th className="px-3 py-2">Qtd.</th>
                  <th className="px-3 py-2">Valor bruto</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {items.map((item, index) => {
                  const isSelected = selectedItemId === item.id;
                  const gross = parseDecimal(item.gross);
                  return (
                    <tr
                      key={item.id}
                      className={`${index % 2 === 0 ? 'bg-[var(--color-surface-card)]' : 'bg-[var(--color-gray-50)]'} ${isSelected ? 'outline outline-2 outline-[var(--color-brand-primary)]/40' : ''}`}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <td className="sticky left-0 z-10 bg-inherit px-3 py-3 text-sm text-[var(--color-text-primary)]">
                        <div className="font-semibold leading-tight">{item.description || item.productCode || 'Sem descrição'}</div>
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          NF {item.invoice.chave ? `${item.invoice.chave.slice(0, 6)}…${item.invoice.chave.slice(-6)}` : '—'} ·{' '}
                          {item.invoice.type === 'IN' ? 'Entrada' : 'Saída'}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">{item.cfopCode || '—'}</td>
                      <td className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">{item.unit || '—'}</td>
                      <td className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">{item.qty}</td>
                      <td className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">{gross != null ? formatCurrencySafe(gross) : 'R$ --'}</td>
                      <td className="px-3 py-3 text-right text-sm">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDrawerState({ open: true, mode: 'map', type: 'map', item });
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-xs font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
                        >
                          Mapear
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderQueueDetail = () => {
    if (!selectedItem) {
      return <div className="flex h-full min-h-[340px] items-center justify-center text-sm text-[var(--color-text-secondary)]">Selecione um item para mapear.</div>;
    }
    const gross = parseDecimal(selectedItem.gross);
    return (
      <div className="space-y-4 border-t border-[var(--color-border-subtle)] pt-4">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Item da NF-e</p>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{selectedItem.description || selectedItem.productCode || 'Sem descrição'}</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            NF {selectedItem.invoice.chave ? `${selectedItem.invoice.chave.slice(0, 6)}…${selectedItem.invoice.chave.slice(-6)}` : '—'} ·{' '}
            {selectedItem.invoice.type === 'IN' ? 'Entrada' : 'Saída'} · Emissão {selectedItem.invoice.emissao ? formatDate(selectedItem.invoice.emissao) : '—'}
          </p>
        </header>
        <dl className="grid grid-cols-2 gap-3 text-sm text-[var(--color-text-secondary)]">
          <div>
            <dt>Quantidade</dt>
            <dd className="font-mono text-[var(--color-text-primary)]">
              {selectedItem.qty} {selectedItem.unit || ''}
            </dd>
          </div>
          <div>
            <dt>Valor bruto</dt>
            <dd className="font-mono text-[var(--color-text-primary)]">{gross != null ? formatCurrencySafe(gross) : 'R$ --'}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => setDrawerState({ open: true, mode: 'map', type: 'map', item: selectedItem })}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-primary)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
        >
          Mapear item
        </button>
      </div>
    );
  };

  const renderCompositions = () => (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="border-t border-b border-[var(--color-border-subtle)]">
        {compositionsLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-12 animate-pulse rounded-lg bg-[var(--color-gray-100)]/80" />
            ))}
          </div>
        ) : compositionError ? (
          <div className="p-4 text-sm text-[var(--color-feedback-danger)]">{compositionError}</div>
        ) : compositions.length === 0 ? (
          <div className="p-6 text-sm text-[var(--color-text-secondary)]">Nenhuma composição cadastrada.</div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[880px] table-auto divide-y divide-[var(--color-border-subtle)] text-left text-sm">
              <thead className="sticky top-0 bg-[var(--color-gray-50)] text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-3 py-2">Matéria-prima</th>
                  <th className="px-3 py-2">Produto acabado</th>
                  <th className="px-3 py-2">Relação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {compositions.map((composition, index) => (
                  <tr key={composition.id} className={index % 2 === 0 ? 'bg-[var(--color-surface-card)]' : 'bg-[var(--color-gray-50)]'}>
                    <td className="px-3 py-3 text-sm text-[var(--color-text-primary)]">
                      <div className="font-semibold">{composition.rawProduct.name}</div>
                      <p className="text-xs text-[var(--color-text-secondary)]">SKU {composition.rawProduct.sku || '—'} · {composition.rawProduct.unit || '—'}</p>
                    </td>
                    <td className="px-3 py-3 text-sm text-[var(--color-text-primary)]">
                      <div className="font-semibold">{composition.finishedProduct.name}</div>
                      <p className="text-xs text-[var(--color-text-secondary)]">SKU {composition.finishedProduct.sku || '—'} · {composition.finishedProduct.unit || '—'}</p>
                    </td>
                    <td className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">
                      {Number(composition.ratio).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border-subtle)] pt-6 space-y-5 w-full md:max-w-3xl md:ml-auto md:px-6 px-3">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Nova composição</p>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">Relacionar produtos</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">Defina matéria-prima, produto acabado e a proporção.</p>
        </header>
        <form className="mt-4 space-y-3" onSubmit={handleCreateComposition}>
          <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
            <span className="font-medium">Matéria-prima</span>
            <select name="raw" className="h-10 w-full rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm">
              <option value="">Selecione</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
            <span className="font-medium">Produto acabado</span>
            <select name="finished" className="h-10 w-full rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm">
              <option value="">Selecione</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
            <span className="font-medium">Relação</span>
            <input
              name="ratio"
              placeholder="Ex.: 0,45"
              className="h-10 w-full rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
          >
            Adicionar
          </button>
        </form>
      </div>
    </div>
  );

  const renderDrawerContent = () => {
    if (!drawerState.open) return null;

    if (drawerState.type === 'product') {
      const product = drawerState.product;
      return (
        <Drawer
          open={drawerState.open}
          title={drawerState.mode === 'create' ? 'Novo produto' : 'Editar produto'}
          onClose={() => setDrawerState({ open: false })}
          placement="side"
        >
          <form className="space-y-3" onSubmit={(event) => handleSaveProduct(event, { id: drawerState.mode === 'edit' ? product?.id : undefined })}>
            <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
              <span className="font-medium">Nome</span>
              <input
                name="name"
                defaultValue={product?.name || ''}
                required
                className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
              />
            </label>
            <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
              <span className="font-medium">SKU</span>
              <input name="sku" defaultValue={product?.sku || ''} className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm" />
            </label>
            <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
              <span className="font-medium">Unidade</span>
              <input
                name="unit"
                defaultValue={product?.unit || ''}
                className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
              />
            </label>
            <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
              <span className="font-medium">NCM</span>
              <input name="ncm" defaultValue={product?.ncm || ''} className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm" />
            </label>
            <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
              <span className="font-medium">Descrição</span>
              <textarea
                name="description"
                defaultValue={product?.description || ''}
                className="rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-sm shadow-sm"
                rows={3}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDrawerState({ open: false })}
                className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
              >
                {drawerState.mode === 'create' ? 'Salvar' : 'Atualizar'}
              </button>
            </div>
          </form>
        </Drawer>
      );
    }

    if (drawerState.type === 'map' && drawerState.item) {
      const item = drawerState.item;
      const sourceQty = parseDecimal(item.qty);
      const convertedQtyNumber = parseDecimal(mapConvertedQty);
      const convertedUnitPrice =
        convertedQtyNumber && convertedQtyNumber > 0 && parseDecimal(item.gross) != null
          ? (parseDecimal(item.gross) as number) / convertedQtyNumber
          : null;
      const factor = sourceQty && convertedQtyNumber ? convertedQtyNumber / sourceQty : null;
      return (
        <Drawer open={drawerState.open} title="Mapear item" onClose={() => setDrawerState({ open: false })} placement="center">
          <div className="space-y-4 text-sm text-[var(--color-text-secondary)]">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.24em]">Item da nota</p>
              <p className="text-base font-semibold text-[var(--color-text-primary)]">
                {item.description || item.productCode || 'Sem descrição'}
              </p>
              <p className="text-xs">
                {item.invoice.type === 'IN' ? 'Entrada' : 'Saída'} · NF{' '}
                {item.invoice.chave ? `${item.invoice.chave.slice(0, 6)}…${item.invoice.chave.slice(-6)}` : '—'} · Emissão{' '}
                {item.invoice.emissao ? formatDate(item.invoice.emissao) : '—'}
              </p>
            </div>
            <div className="grid gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-3 text-xs">
              <div className="flex flex-wrap gap-3">
                <span className="font-semibold text-[var(--color-text-primary)]">CFOP {item.cfopCode || '—'}</span>
                <span className="font-semibold text-[var(--color-text-primary)]">
                  Unidade {item.unit || '—'} · Quantidade {item.qty}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                <span>Preço unitário {item.unitPrice || '—'}</span>
                <span>Valor bruto {item.gross ? formatCurrencySafe(parseDecimal(item.gross)) : 'R$ --'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleCreateProductFromItem(item)}
                  disabled={isCreatingFromItem || !selectedCompanyId}
                >
                  {isCreatingFromItem ? 'Criando…' : 'Criar produto com este item'}
                </Button>
                <p className="text-[var(--color-text-secondary)]">
                  Gera um produto no catálogo usando descrição, código, unidade e NCM do item da nota.
                </p>
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-white p-3 text-xs">
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[var(--color-text-primary)] font-semibold">Quantidade (nota)</p>
                  <p className="font-mono text-sm text-[var(--color-text-primary)]">
                    {sourceQty != null ? sourceQty : item.qty} {item.unit || ''}
                  </p>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[var(--color-text-primary)] font-semibold">Quantidade convertida</p>
                  <p className="font-mono text-sm text-[var(--color-text-primary)]">
                    {mapConvertedQty || '—'} {activeMapProduct?.unit || 'unid. gerencial'}
                  </p>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <p className="text-[var(--color-text-primary)] font-semibold">Fator aplicado</p>
                  <p className="font-mono text-sm text-[var(--color-text-primary)]">
                    {factor && Number.isFinite(factor) ? factor.toFixed(4) : '—'}
                  </p>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[var(--color-text-primary)] font-semibold">Valor unitário convertido</p>
                  <p className="font-mono text-sm text-[var(--color-text-primary)]">
                    {convertedUnitPrice != null && Number.isFinite(convertedUnitPrice)
                      ? formatCurrencySafe(convertedUnitPrice)
                      : 'R$ --'}
                  </p>
                </div>
              </div>
              <p className="text-[var(--color-text-secondary)]">
                Ajuste a quantidade convertida conforme a unidade do produto do catálogo. Usamos fator = convertido / quantidade da nota e recalculamos o valor unitário convertido.
              </p>
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) =>
                handleMapItem(event, item, {
                  productId: mapProductId,
                  convertedQty: mapConvertedQty,
                  notes: mapNotes,
                  applySimilar: mapApplySimilar,
                })
              }
            >
              <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
                <span className="font-medium">Produto do catálogo</span>
                <select
                  name="productId"
                  value={mapProductId}
                  onChange={(event) => setMapProductId(event.target.value)}
                  className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm shadow-sm"
                >
                  <option value="">Selecione</option>
                  {products.map((product, index) => (
                    <option key={`${product.id}-${index}`} value={product.id}>
                      {product.name} {product.sku ? `· ${product.sku}` : ''}
                    </option>
                  ))}
                </select>
                {suggestedProducts.length ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
                    <span className="font-semibold text-[var(--color-text-primary)]">Sugestões:</span>
                    {suggestedProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => setMapProductId(product.id)}
                        className={`rounded-full border px-2.5 py-0.5 font-semibold transition ${
                          mapProductId === product.id
                            ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]'
                            : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)]'
                        }`}
                      >
                        {product.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>
              <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
                <span className="font-medium">Quantidade convertida</span>
                <input
                  name="convertedQty"
                  value={mapConvertedQty}
                  onChange={(event) => setMapConvertedQty(event.target.value)}
                  className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 font-mono text-sm shadow-sm"
                />
              </label>
              <label className="grid gap-1 text-sm text-[var(--color-text-primary)]">
                <span className="font-medium">Observações</span>
                <textarea
                  name="notes"
                  value={mapNotes}
                  onChange={(event) => setMapNotes(event.target.value)}
                  className="rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-sm shadow-sm"
                  rows={3}
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  name="applySimilar"
                  checked={mapApplySimilar}
                  onChange={(event) => setMapApplySimilar(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border border-[var(--color-border-subtle)] text-[var(--color-brand-secondary)] focus:ring-[var(--color-brand-accent)]"
                />
                <span className="leading-tight">
                  Aplicar a itens semelhantes (mesma descrição/unidade) ainda pendentes na fila.
                </span>
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDrawerState({ open: false })}
                  className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
                >
                  Mapear
                </button>
              </div>
            </form>
          </div>
        </Drawer>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 px-4 md:px-6">
      {feedback ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-[var(--color-feedback-danger)]/70 bg-[var(--color-feedback-danger)]/10 text-[var(--color-feedback-danger)]'
          }`}
        >
          {feedback.message}
        </div>
      ) : null}
      <header
        className="sticky z-30 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-3"
        style={{ top: STICKY_OFFSET - 16 }}
      >
        <div className="space-y-1">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
            <span className="uppercase tracking-[0.24em]">Produtos</span>
            <span aria-hidden>·</span>
            <span className="text-[var(--color-text-primary)]">Operação</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Catálogo e conciliação</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {topMetrics.map((metric) => (
                <span
                  key={metric.label}
                  className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1 font-semibold text-[var(--color-text-primary)]"
                >
                  {metric.label}: <span className="font-mono">{metric.value}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAutoMap}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] shadow-sm hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
          >
            <Sparkles className="h-4 w-4 text-[var(--color-brand-secondary)]" aria-hidden="true" />
            Auto-mapear
          </button>
          <button
            type="button"
            disabled={!autoUndoIds.length}
            onClick={handleUndoAutoMap}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold shadow-sm focus-visible:outline-focus-visible ${
              autoUndoIds.length
                ? 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-brand-accent)] hover:text-[var(--color-brand-primary)]'
                : 'cursor-not-allowed border-[var(--color-border-subtle)] bg-[var(--color-gray-100)] text-[var(--color-text-secondary)]'
            }`}
          >
            Desfazer conciliação
            {autoUndoIds.length ? <span className="font-mono text-[var(--color-brand-secondary)]">({autoUndoIds.length})</span> : null}
          </button>
          <button
            type="button"
            onClick={() => setDrawerState({ open: true, mode: 'create', type: 'product' })}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-primary)] px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--color-brand-primary-strong)] focus-visible:outline-focus-visible"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo produto
          </button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
        <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1 font-semibold text-[var(--color-text-primary)]">
          Catálogo: {products.length}
        </span>
        <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1 font-semibold text-[var(--color-text-primary)]">
          Fila (filtro só não mapeados): {queueFilters.onlyUnmapped ? items.length : `${items.length} (todos)`}
        </span>
        {productsLoading || itemsLoading ? <span className="text-[var(--color-text-secondary)]">Atualizando dados…</span> : null}
        {autoSummary ? <span className="text-[var(--color-text-secondary)]">Último auto-map: {autoSummary}</span> : null}
      </div>

      {noCompany ? (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-6 text-sm text-[var(--color-text-secondary)] shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-[var(--color-brand-secondary)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">Nenhuma empresa selecionada</p>
              <p>Selecione uma empresa para trabalhar o catálogo e a fila.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]">
            <button
              type="button"
              onClick={() => setTab('catalog')}
              className={`px-3 py-2 ${tab === 'catalog' ? 'text-[var(--color-brand-primary)] font-bold' : 'text-[var(--color-text-primary)]'}`}
            >
              Catálogo
            </button>
            <button
              type="button"
              onClick={() => setTab('queue')}
              className={`px-3 py-2 ${tab === 'queue' ? 'text-[var(--color-brand-primary)] font-bold' : 'text-[var(--color-text-primary)]'}`}
            >
              Fila de mapeamento
            </button>
            <button
              type="button"
              onClick={() => setTab('compositions')}
              className={`px-3 py-2 ${tab === 'compositions' ? 'text-[var(--color-brand-primary)] font-bold' : 'text-[var(--color-text-primary)]'}`}
            >
              Composições
            </button>
          </div>

          {tab === 'catalog' ? (
            <div className="space-y-6">
              {renderCatalogTable()}
              {renderCatalogDetail()}
            </div>
          ) : null}

          {tab === 'queue' ? (
            <div className="space-y-6">
              {renderQueueTable()}
              {renderQueueDetail()}
            </div>
          ) : null}

          {tab === 'compositions' ? renderCompositions() : null}
        </>
      )}

      {autoSummary ? (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">{autoSummary}</div>
      ) : null}
      {productError ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm font-semibold text-[var(--color-feedback-danger)]">
          {productError}
        </div>
      ) : null}
      {itemError ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm font-semibold text-[var(--color-feedback-danger)]">
          {itemError}
        </div>
      ) : null}
      {compositionError ? (
        <div className="rounded-lg border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-3 py-2 text-sm font-semibold text-[var(--color-feedback-danger)]">
          {compositionError}
        </div>
      ) : null}

      {renderDrawerContent()}
    </div>
  );
}
