'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/api';
import { formatCnpj } from '@/lib/format';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Modal } from '@/ui/modal';
import { useCompanyContext } from '../_context/company-context';

type CreateCompanyResponse = {
  item: {
    id: string;
    name: string;
    cnpj: string;
    createdAt: string;
    updatedAt: string;
  };
};

type ResetDataResponse = {
  message: string;
  summary: {
    invoices: number;
    invoiceItems: number;
    mappings: number;
    unitConversions: number;
    mappingRules: number;
    naturezaAliases: number;
    naturezas: number;
    cfopRules: number;
    uploadBatches: number;
    reprocessBatches: number;
    cancellations: number;
    stockMovements: number;
  };
};

export default function CompaniesPage() {
  const {
    companies,
    isLoading,
    error,
    refreshCompanies,
    selectedCompanyId,
    selectCompany,
  } = useCompanyContext();
  const router = useRouter();

  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetConfirmValue, setResetConfirmValue] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{
    message: string;
    summary: {
      invoices: number;
      invoiceItems: number;
      mappings: number;
      unitConversions: number;
      mappingRules: number;
      naturezaAliases: number;
      naturezas: number;
      cfopRules: number;
      uploadBatches: number;
      reprocessBatches: number;
      cancellations: number;
      stockMovements: number;
    };
    companyName: string;
    companyCnpj: string;
  } | null>(null);

  const orderedCompanies = useMemo(() => companies, [companies]);
  const activeCompany = useMemo(
    () => orderedCompanies.find((company) => company.id === selectedCompanyId) ?? null,
    [orderedCompanies, selectedCompanyId],
  );

  const activeCompanyCnpjDigits = activeCompany ? activeCompany.cnpj.replace(/\D/g, '') : '';
  const expectedResetToken = activeCompany ? `ZERAR ${activeCompanyCnpjDigits}` : '';
  const canResetCompany = Boolean(activeCompany && activeCompanyCnpjDigits.length === 14);

  useEffect(() => {
    setResetError(null);
    setResetConfirmValue('');
    setIsResetDialogOpen(false);
  }, [activeCompany?.id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    const trimmedName = name.trim();
    const trimmedCnpj = cnpj.trim();

    if (!trimmedName || !trimmedCnpj) {
      setFeedback('Informe nome e CNPJ.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetchJson<CreateCompanyResponse>('/companies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName, cnpj: trimmedCnpj }),
      });
      setName('');
      setCnpj('');
      setFeedback('Empresa cadastrada com sucesso.');
      await refreshCompanies();
      selectCompany(response.item.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível cadastrar a empresa.';
      setFeedback(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOperate = (companyId: string) => {
    selectCompany(companyId);
    router.push('/app');
  };

  const openResetDialog = () => {
    if (!activeCompany) {
      setResetError('Selecione uma empresa antes de zerar os dados.');
      return;
    }
    if (!canResetCompany) {
      setResetError('O CNPJ da empresa precisa conter 14 dígitos para habilitar o reset.');
      return;
    }
    setResetConfirmValue('');
    setResetError(null);
    setIsResetDialogOpen(true);
  };

  const closeResetDialog = () => {
    if (isResetting) return;
    setIsResetDialogOpen(false);
    setResetConfirmValue('');
    setResetError(null);
  };

  const handleResetData = async () => {
    if (!activeCompany) {
      setResetError('Selecione uma empresa válida antes de prosseguir.');
      return;
    }

    if (!canResetCompany) {
      setResetError('O CNPJ da empresa precisa conter 14 dígitos para habilitar o reset.');
      return;
    }

    if (resetConfirmValue.trim() !== expectedResetToken) {
      setResetError(`Digite exatamente "${expectedResetToken}" para confirmar.`);
      return;
    }

    setIsResetting(true);
    setResetError(null);

    try {
      const response = await fetchJson<ResetDataResponse>(
        `/companies/${activeCompany.id}/reset-data`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: expectedResetToken }),
        },
      );

      setResetResult({
        message: response.message,
        summary: response.summary,
        companyName: activeCompany.name,
        companyCnpj: activeCompany.cnpj,
      });
      setIsResetDialogOpen(false);
      setResetConfirmValue('');
      await refreshCompanies();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao zerar dados da empresa.';
      setResetError(message);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Empresas cadastradas</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Selecione uma empresa para operar ou cadastre novas entidades para simulações reais.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-6 shadow-sm">
        {isLoading ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Carregando empresas...</p>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-feedback-danger)] bg-[var(--color-feedback-danger)]/10 px-4 py-3 text-sm text-[var(--color-feedback-danger)]">
            {error}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                void refreshCompanies();
              }}
            >
              Tentar novamente
            </Button>
          </div>
        ) : orderedCompanies.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Nenhuma empresa cadastrada ainda. Utilize o formulário abaixo.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {orderedCompanies.map((company) => {
              const isActive = selectedCompanyId === company.id;
              return (
                <article
                  key={company.id}
                  className={`flex h-full flex-col justify-between rounded-2xl border px-5 py-4 transition ${
                    isActive
                      ? 'border-[var(--color-brand-primary)] bg-white shadow-md'
                      : 'border-[var(--color-border-subtle)] bg-white hover:border-[var(--color-brand-accent)]/40 hover:shadow-sm'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{company.name}</h3>
                      {isActive ? (
                        <Badge variant="info" uppercase={false} className="text-[0.65rem]">
                          Selecionada
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      CNPJ{' '}
                      <span className="font-mono tabular-nums text-[var(--color-text-primary)]">
                        {formatCnpj(company.cnpj)}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      ID <span className="font-mono">{company.id}</span>
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={isActive ? 'primary' : 'secondary'}
                      onClick={() => selectCompany(company.id)}
                    >
                      {isActive ? 'Selecionada' : 'Selecionar'}
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/app/invoices?companyId=${encodeURIComponent(company.id)}`}>Ver notas</Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOperate(company.id)}
                      className="text-[var(--color-brand-secondary)] hover:text-[var(--color-brand-primary)]"
                    >
                      Operar
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-6 [grid-template-columns:minmax(0,3fr)_minmax(0,2fr)]">
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-6 shadow-sm"
        >
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-text-secondary)]/80">
              Cadastrar nova empresa
            </p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Inclua empresas reais com CNPJ válido (14 dígitos).
            </p>
          </div>
          <div className="grid grid-cols-6 gap-3">
            <label className="col-span-4 grid gap-1 text-sm text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">Nome</span>
              <input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ex: JM ALIMENTOS LTDA"
                className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/20"
              />
            </label>
            <label className="col-span-2 grid gap-1 text-sm text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">CNPJ</span>
              <input
                name="cnpj"
                value={cnpj}
                onChange={(event) => setCnpj(event.target.value)}
                placeholder="00.000.000/0000-00"
                className="h-9 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-text-primary)] shadow-sm transition focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/20"
              />
            </label>
            <div className="col-span-2 flex items-end">
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Cadastrando…' : 'Cadastrar empresa'}
              </Button>
            </div>
            {feedback ? (
              <div className="col-span-6 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
                {feedback}
              </div>
            ) : null}
          </div>
        </form>

        <aside className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-text-secondary)]">Dicas</p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--color-text-secondary)]">
            <li>• Utilize CNPJs reais para subir XMLs de testes autênticos.</li>
            <li>• Vincule notas fiscais do mesmo CNPJ para consolidar indicadores.</li>
            <li>• Após cadastrar, selecione a empresa no topo para operar nos demais módulos.</li>
          </ul>
        </aside>
      </section>

      <section className="rounded-2xl border border-[var(--color-feedback-danger)]/40 bg-[var(--color-feedback-danger)]/12 p-6 shadow-sm">
        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-feedback-danger)]">
              Zerar dados da empresa
            </p>
            <p className="text-sm text-[var(--color-feedback-danger)]">
              Remove notas, itens importados, conciliações, regras de CFOP/Natureza e conversões de unidade apenas da empresa selecionada.
              As demais empresas permanecem intactas e o cadastro da empresa é preservado.
            </p>
            {activeCompany ? (
              <p className="text-xs font-medium text-[var(--color-feedback-danger)]">
                Empresa selecionada: {activeCompany.name} • CNPJ {formatCnpj(activeCompany.cnpj)}{' '}
                {!canResetCompany && '— informe um CNPJ válido (14 dígitos) para habilitar o reset.'}
              </p>
            ) : (
              <p className="text-xs font-medium text-[var(--color-feedback-danger)]">
                Selecione uma empresa para habilitar esta ação.
              </p>
            )}
          </div>
          <Button
            type="button"
            onClick={openResetDialog}
            disabled={isResetting || !canResetCompany}
            variant="danger"
            size="sm"
            className="w-fit"
          >
            {isResetting ? 'Processando...' : 'Zerar dados desta empresa'}
          </Button>
          {resetError && !isResetDialogOpen && (
            <div className="rounded-xl border border-[var(--color-feedback-danger)] bg-white px-4 py-2 text-xs text-[var(--color-feedback-danger)]">
              {resetError}
            </div>
          )}
          {resetResult && (
            <div className="space-y-2 rounded-xl border border-[var(--color-feedback-danger)] bg-white px-4 py-3 text-xs text-[var(--color-feedback-danger)]">
              <p className="text-sm font-semibold text-[var(--color-feedback-danger)]">{resetResult.message}</p>
              <p className="text-[0.7rem] text-[var(--color-feedback-danger)]/80">
                Empresa: {resetResult.companyName} • CNPJ {formatCnpj(resetResult.companyCnpj)}
              </p>
              <ul className="space-y-1 text-[0.7rem]">
                {(() => {
                  const entries = [
                    { label: 'Notas fiscais removidas', value: resetResult.summary.invoices },
                    { label: 'Itens de nota removidos', value: resetResult.summary.invoiceItems },
                    { label: 'Vínculos de conciliação removidos', value: resetResult.summary.mappings },
                    { label: 'Movimentações de estoque removidas', value: resetResult.summary.stockMovements },
                    { label: 'Conversões de unidade removidas', value: resetResult.summary.unitConversions },
                    { label: 'Regras de vinculação aprendidas removidas', value: resetResult.summary.mappingRules },
                    { label: 'Naturezas de operação removidas', value: resetResult.summary.naturezas },
                    { label: 'Aliases de natureza removidos', value: resetResult.summary.naturezaAliases },
                    { label: 'Regras de CFOP removidas', value: resetResult.summary.cfopRules },
                    { label: 'Lotes de upload removidos', value: resetResult.summary.uploadBatches },
                    { label: 'Reprocessamentos removidos', value: resetResult.summary.reprocessBatches },
                    { label: 'Eventos de cancelamento removidos', value: resetResult.summary.cancellations },
                  ].filter((entry) => entry.value > 0);

                  if (!entries.length) {
                    return (
                      <li className="text-red-500">Nenhum registro operacional foi encontrado para remover.</li>
                    );
                  }

                  return entries.map((entry) => (
                    <li key={entry.label}>
                      {entry.label}: <span className="font-semibold text-red-700">{entry.value}</span>
                    </li>
                  ));
                })()}
              </ul>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={Boolean(isResetDialogOpen && activeCompany)}
        onClose={() => {
          if (!isResetting) {
            closeResetDialog();
          }
        }}
        title="Zerar dados da empresa selecionada"
        description="Esta operação remove dados operacionais e não pode ser desfeita."
        size="lg"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={closeResetDialog} disabled={isResetting}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={handleResetData} disabled={isResetting}>
              {isResetting ? 'Zerando…' : 'Confirmar remoção'}
            </Button>
          </>
        )}
      >
        {activeCompany ? (
          <div className="space-y-4 text-sm text-[var(--color-text-secondary)]">
            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-white p-4 shadow-sm">
              <p className="text-base font-semibold text-[var(--color-text-primary)]">{activeCompany.name}</p>
              <p className="font-mono text-xs text-[var(--color-text-secondary)]">
                CNPJ {formatCnpj(activeCompany.cnpj)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  Removidos
                </p>
                <ul className="mt-2 space-y-1 list-disc pl-4 text-xs">
                  <li>Notas de entrada e saída e todos os itens importados.</li>
                  <li>Vínculos de conciliação, movimentações de estoque e lotes de upload/reprocessamento.</li>
                  <li>Regras de CFOP, naturezas de operação e conversões de unidade associadas.</li>
                  <li>Regras aprendidas de vinculação e registros de cancelamento das notas.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-gray-50)] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  Preservados
                </p>
                <ul className="mt-2 space-y-1 list-disc pl-4 text-xs">
                  <li>Cadastro da empresa (nome, CNPJ e ID) e demais empresas do ambiente.</li>
                  <li>Catálogo de produtos e demais configurações não derivadas das notas.</li>
                </ul>
              </div>
            </div>

            <label className="grid gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">
                Confirme digitando{' '}
                <span className="font-mono text-[var(--color-brand-primary)]">{expectedResetToken}</span>
              </span>
              <input
                value={resetConfirmValue}
                onChange={(event) => setResetConfirmValue(event.target.value)}
                placeholder={expectedResetToken}
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30"
                autoFocus
              />
            </label>
            {resetError ? <p className="text-xs text-[var(--color-feedback-danger)]">{resetError}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
