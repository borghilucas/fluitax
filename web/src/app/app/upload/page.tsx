'use client';

import { FormEvent, Suspense, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, fetchJson } from '@/lib/api';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useCompanyContext } from '../_context/company-context';

type UploadResult = {
  inserted: number;
  duplicate: number;
  failed: number;
  details: Array<{
    file: string;
    status: 'inserted' | 'duplicate' | 'failed';
    reason?: string | null;
  }>;
};

type UploadPageContentProps = {
  initialCompanyId: string;
  fallbackCompanyId?: string;
};

function UploadPageContent({ initialCompanyId, fallbackCompanyId }: UploadPageContentProps) {
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dropRef = useRef<HTMLLabelElement | null>(null);
  const { selectedCompanyId, handleCompanyNotFound } = useCompanyContext();

  const limitsInfo = useMemo(() => {
    const maxFiles = process.env.NEXT_PUBLIC_MAX_XML_FILES || '10000';
    const maxSize = process.env.NEXT_PUBLIC_MAX_XML_FILE_SIZE_MB || '5';
    return { maxFiles, maxSize };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!companyId.trim()) {
      setError('Informe o companyId.');
      return;
    }

    if (!file) {
      setError('Selecione um arquivo .zip contendo as notas.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setIsSubmitting(true);
    setError(null);

    try {
      const summary = await fetchJson<UploadResult>(
        `/invoices/upload-xml?companyId=${encodeURIComponent(companyId.trim())}`,
        {
          method: 'POST',
          body: formData,
          onNotFound: () => handleCompanyNotFound(companyId.trim() || selectedCompanyId),
        }
      );
      setResult(summary);
      setFile(null);
      setFileKey((key) => key + 1);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Upload falhou. Tente novamente.';
      setError(message);
      setResult(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetSelection = () => {
    setFile(null);
    setFileKey((key) => key + 1);
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-5 py-6 shadow-sm">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Importação</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Subir XMLs de NF-e</h1>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Envie um arquivo .zip com XMLs de NF-e. Ele é processado em memória e gravado direto no banco (nenhum arquivo fica salvo em disco).
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1">
                Limite de arquivos: {limitsInfo.maxFiles}
              </span>
              <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-1">
                Até {limitsInfo.maxSize} MB por XML
              </span>
            </div>
          </div>
        </header>

        <form className="grid gap-6 lg:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)]" onSubmit={handleSubmit}>
          <div className="space-y-3">
            <label className="grid gap-2 text-sm text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">Empresa (companyId)</span>
              <input
                name="companyId"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                placeholder="comp_xxx..."
                className="h-10 rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
              />
              {fallbackCompanyId && fallbackCompanyId !== companyId && (
                <button
                  type="button"
                  onClick={() => setCompanyId(fallbackCompanyId)}
                  className="w-fit text-xs font-medium text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
                >
                  Usar empresa selecionada ({fallbackCompanyId})
                </button>
              )}
            </label>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-3 text-xs text-[var(--color-text-secondary)]">
              <p className="font-semibold text-[var(--color-text-primary)]">Como funciona</p>
              <ul className="mt-2 space-y-1 list-disc pl-4">
                <li>Validação de layout e cancelamentos; notas canceladas são registradas em tabela própria.</li>
                <li>Nenhum arquivo fica armazenado em disco — apenas os dados persistem no banco.</li>
                <li>Use “fila de mapeamento” em Produtos para vincular itens importados.</li>
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            <label
              ref={dropRef}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped && dropped.name.toLowerCase().endsWith('.zip')) {
                  setFile(dropped);
                  setFileKey((key) => key + 1);
                }
              }}
              className={`flex h-full min-h-[200px] cursor-pointer flex-col justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition ${isDragging ? 'border-[var(--color-brand-primary)] bg-[var(--color-gray-50)]' : 'border-[var(--color-border-subtle)] bg-white'} hover:border-[var(--color-brand-accent)]`}
            >
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">Arraste e solte o .zip aqui</span>
              <span className="text-xs text-[var(--color-text-secondary)]">ou clique para selecionar um arquivo .zip com XMLs de NF-e</span>
              <input
                key={fileKey}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                }}
              />
              {file ? (
                <div className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={resetSelection}
                    className="text-xs font-medium text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline"
                  >
                    remover
                  </button>
                </div>
              ) : null}
            </label>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Enviando...' : 'Enviar XMLs'}
              </Button>
            </div>
          </div>
        </form>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--color-feedback-danger)]/60 bg-[var(--color-feedback-danger)]/10 px-4 py-3 text-sm text-[var(--color-feedback-danger)]"
        >
          {error}
        </div>
      )}

      {result && (
        <section className="space-y-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-4 py-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            {[{ label: 'Inseridas', value: result.inserted }, { label: 'Duplicadas', value: result.duplicate }, { label: 'Falhas', value: result.failed }].map((item) => (
              <div key={item.label} className="rounded-xl border border-[var(--color-border-subtle)] bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">{item.label}</p>
                <p className="text-2xl font-semibold text-[var(--color-text-primary)]">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
            <table className="min-w-full divide-y divide-[var(--color-border-subtle)] text-left text-sm">
              <thead className="bg-[var(--color-gray-50)] text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-3 py-2">Arquivo</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {result.details.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-center text-sm text-[var(--color-text-secondary)]">
                      Nenhum detalhe retornado.
                    </td>
                  </tr>
                ) : (
                  result.details.map((detail) => (
                    <tr key={`${detail.file}-${detail.status}`} className="bg-white">
                      <td className="px-3 py-3 text-xs font-medium text-[var(--color-text-primary)] break-all">{detail.file}</td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={detail.status === 'failed' ? 'danger' : detail.status === 'duplicate' ? 'warning' : 'success'}
                          uppercase
                        >
                          {detail.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--color-text-secondary)]">{detail.reason || '--'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function UploadPageWithParams() {
  const searchParams = useSearchParams();
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const resolvedCompanyId = searchParams.get('companyId') ?? selectedCompanyId ?? '';

  return (
    <div className="space-y-6">
      {selectedCompany && (
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-text-primary)]">Empresa selecionada:</span>{' '}
          {selectedCompany.name} — <span className="font-mono tabular-nums">{selectedCompany.cnpj}</span>
        </div>
      )}
      <UploadPageContent
        key={resolvedCompanyId}
        initialCompanyId={resolvedCompanyId}
        fallbackCompanyId={selectedCompanyId ?? undefined}
      />
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense
      fallback={(
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
          Carregando formulário de upload...
        </div>
      )}
    >
      <UploadPageWithParams />
    </Suspense>
  );
}
