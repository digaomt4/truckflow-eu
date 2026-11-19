import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Trash2,
  AlertCircle,
  CheckCircle2,
  X,
  Receipt,
  FileText,
  FileSpreadsheet,
  ParkingCircle,
  Ticket,
  Droplets,
  Utensils,
  Fuel,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  compressReceiptPhoto,
  deleteExpense,
  resolveExpenseReceipt,
  saveExpense,
  subscribeExpenses,
} from '../../services/expensesService';
import {
  formatEuro,
  formatMonthLabel,
  getLocalDateISO,
  getMonthKey,
  shiftMonthKey,
} from '../../utils/salaryCalculator';
import ConfirmModal from '../../components/ui/ConfirmModal';
import ImageLightbox from '../../components/ui/ImageLightbox';

const CATEGORY_ICONS = {
  parking: ParkingCircle,
  toll: Ticket,
  wash: Droplets,
  food: Utensils,
  fuel: Fuel,
  other: Receipt,
};

export default function ExpensesModule({ user }) {
  const currentMonthKey = getMonthKey(new Date());
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [expenses, setExpenses] = useState([]);

  const [category, setCategory] = useState('parking');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getLocalDateISO);
  const [description, setDescription] = useState('');
  const [reimbursable, setReimbursable] = useState(true);
  const [receiptFullDataUrl, setReceiptFullDataUrl] = useState('');
  const [receiptThumbDataUrl, setReceiptThumbDataUrl] = useState('');

  const [filterType, setFilterType] = useState('all');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [lightboxState, setLightboxState] = useState({
    isOpen: false,
    images: [],
    initialIndex: 0,
  });

  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeExpenses(user?.uid || null, (list) => {
      setExpenses(list);
    });
    return () => unsub();
  }, [user?.uid]);

  const categoryLabels = useMemo(
    () => Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.id, c.label])),
    []
  );

  const monthExpenses = useMemo(
    () =>
      expenses.filter(
        (item) => (item.monthKey || getMonthKey(item.date)) === selectedMonth
      ),
    [expenses, selectedMonth]
  );

  const totals = useMemo(() => {
    let reimbursableTotal = 0;
    let personalTotal = 0;
    const byCategory = {};

    for (const item of monthExpenses) {
      const val = Number(item.amount) || 0;
      if (item.reimbursable) {
        reimbursableTotal += val;
      } else {
        personalTotal += val;
      }
      const cat = item.category || 'other';
      byCategory[cat] = Math.round(((byCategory[cat] || 0) + val) * 100) / 100;
    }

    const total = Math.round((reimbursableTotal + personalTotal) * 100) / 100;
    const reimbursablePct =
      total > 0 ? Math.round((reimbursableTotal / total) * 100) : 0;

    const categoryTotals = Object.entries(byCategory)
      .map(([id, sum]) => ({
        id,
        label: categoryLabels[id] || id,
        amount: sum,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      reimbursable: Math.round(reimbursableTotal * 100) / 100,
      personal: Math.round(personalTotal * 100) / 100,
      total,
      reimbursablePct,
      categoryTotals,
    };
  }, [monthExpenses, categoryLabels]);

  const filteredExpenses = useMemo(() => {
    if (filterType === 'reimbursable') {
      return monthExpenses.filter((e) => e.reimbursable);
    }
    if (filterType === 'personal') {
      return monthExpenses.filter((e) => !e.reimbursable);
    }
    return monthExpenses;
  }, [monthExpenses, filterType]);

  const handleReceiptChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const { fullDataUrl, thumbDataUrl } = await compressReceiptPhoto(file);
      setReceiptFullDataUrl(fullDataUrl);
      setReceiptThumbDataUrl(thumbDataUrl);
    } catch (err) {
      setError(err.message || 'Erro ao processar foto do recibo.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100000) {
      setError('Informe um valor válido maior que 0 €.');
      return;
    }

    setSaving(true);
    try {
      const { expenses: updated } = await saveExpense(user?.uid || null, {
        date,
        category,
        description,
        amount: parsedAmount,
        reimbursable,
        receiptFullDataUrl,
        receiptThumbDataUrl,
      });
      setExpenses(updated);
      setSelectedMonth(getMonthKey(date));
      setAmount('');
      setDescription('');
      setReceiptFullDataUrl('');
      setReceiptThumbDataUrl('');
      setSuccessMsg('Despesa registrada com sucesso!');
    } catch (err) {
      setError(err.message || 'Erro ao salvar despesa.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenReceiptLightbox = async (item) => {
    const src = await resolveExpenseReceipt(item);
    if (!src) return;
    setLightboxState({
      isOpen: true,
      images: [
        {
          src,
          label: `${categoryLabels[item.category] || 'Recibo'} · ${formatEuro(
            item.amount
          )}`,
        },
      ],
      initialIndex: 0,
    });
  };

  const handleExportPdf = async () => {
    setExporting(true);
    setError('');
    try {
      const { exportExpensesReportPdf } = await import(
        '../../utils/monthlyReportExporter'
      );
      const res = await exportExpensesReportPdf({
        monthKey: selectedMonth,
        monthLabel: formatMonthLabel(selectedMonth),
        expenses: monthExpenses,
        totals,
        categoryLabels,
      });
      if (res.method === 'downloaded') {
        setSuccessMsg(`Relatório ${res.fileName} baixado!`);
      } else if (res.method === 'shared') {
        setSuccessMsg(`Relatório ${res.fileName} enviado!`);
      }
    } catch (err) {
      setError(err.message || 'Falha ao exportar PDF de despesas.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      const { exportExpensesReportCsv } = await import(
        '../../utils/monthlyReportExporter'
      );
      const res = exportExpensesReportCsv({
        monthKey: selectedMonth,
        expenses: monthExpenses,
        totals,
        categoryLabels,
      });
      setSuccessMsg(`Planilha ${res.fileName} exportada!`);
    } catch (err) {
      setError(err.message || 'Falha ao exportar CSV.');
    } finally {
      setExporting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    const updated = await deleteExpense(user?.uid || null, id);
    setExpenses(updated);
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Seletor de Mês */}
      <section
        aria-label="Seleção do Mês de Despesas"
        className="ios-card flex items-center justify-between gap-2 px-2.5 py-2"
      >
        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonthKey(m, -1))}
          aria-label="Mês anterior"
          className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-[var(--ios-blue)] transition hover:bg-[var(--ios-fill)] active:scale-90"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex flex-col items-center text-center">
          <span className="text-[16px] font-bold tracking-tight text-[var(--ios-label)]">
            {formatMonthLabel(selectedMonth)}
          </span>
          {selectedMonth !== currentMonthKey && (
            <button
              type="button"
              onClick={() => setSelectedMonth(currentMonthKey)}
              className="mt-0.5 text-[12px] font-semibold text-[var(--ios-blue)] hover:underline"
            >
              Voltar ao mês atual
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonthKey(m, 1))}
          aria-label="Próximo mês"
          className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-[var(--ios-blue)] transition hover:bg-[var(--ios-fill)] active:scale-90"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </section>

      {/* Card de Resumo Mensal */}
      <section aria-label="Resumo de Despesas" className="ios-card p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Total de Despesas ({monthExpenses.length})
          </span>
          {totals.total > 0 && (
            <span className="rounded-full bg-[var(--ios-green)]/12 px-2.5 py-0.5 text-[11px] font-bold text-[var(--ios-green)]">
              {totals.reimbursablePct}% reembolsável
            </span>
          )}
        </div>

        <p className="tabular-nums mt-1 text-[34px] font-extrabold tracking-tight text-[var(--ios-label)]">
          {formatEuro(totals.total)}
        </p>

        {totals.total > 0 && (
          <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-[var(--ios-orange)]/30">
            <div
              className="h-full bg-[var(--ios-green)] transition-all duration-300"
              style={{ width: `${totals.reimbursablePct}%` }}
            />
          </div>
        )}

        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <div className="cp-inset p-3">
            <span className="block text-[11px] font-semibold uppercase text-[var(--ios-label-secondary)]">
              Reembolsável (Empresa)
            </span>
            <span className="tabular-nums mt-0.5 block text-[17px] font-bold text-[var(--ios-green)]">
              {formatEuro(totals.reimbursable)}
            </span>
          </div>
          <div className="cp-inset p-3">
            <span className="block text-[11px] font-semibold uppercase text-[var(--ios-label-secondary)]">
              Pessoal
            </span>
            <span className="tabular-nums mt-0.5 block text-[17px] font-bold text-[#D97706] dark:text-[#F59E0B]">
              {formatEuro(totals.personal)}
            </span>
          </div>
        </div>

        {totals.categoryTotals.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t ios-sep-border pt-3">
            {totals.categoryTotals.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.id] || Receipt;
              return (
                <span
                  key={cat.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border ios-sep-border bg-[var(--ios-fill)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ios-label)]"
                >
                  <Icon className="h-3.5 w-3.5 text-[var(--ios-blue)]" aria-hidden="true" />
                  <span>{cat.label}:</span>
                  <strong className="tabular-nums">{formatEuro(cat.amount)}</strong>
                </span>
              );
            })}
          </div>
        )}

        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={exporting || monthExpenses.length === 0}
            onClick={handleExportPdf}
            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ios-blue)]/10 px-3 text-[13px] font-bold text-[var(--ios-blue)] disabled:opacity-40"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            PDF / WhatsApp
          </button>
          <button
            type="button"
            disabled={exporting || monthExpenses.length === 0}
            onClick={handleExportCsv}
            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border ios-sep-border bg-[var(--ios-fill)] px-3 text-[13px] font-bold text-[var(--ios-label)] disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4 text-[var(--ios-green)]" aria-hidden="true" />
            Excel (CSV)
          </button>
        </div>
      </section>

      {/* Formulário Rápido */}
      <form onSubmit={handleSubmit} className="ios-card space-y-4 p-5">
        <div>
          <h2 className="text-[19px] font-bold tracking-tight text-[var(--ios-label)]">
            Nova Despesa / Reembolso
          </h2>
          <p className="text-[13px] text-[var(--ios-label-secondary)]">
            Guarde recibos de estrada para prestação de contas
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {EXPENSE_CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.id] || Receipt;
            const selected = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold transition ${
                  selected
                    ? 'bg-[var(--ios-blue)] text-white shadow-sm'
                    : 'border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label-secondary)] hover:bg-[var(--ios-fill)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {cat.label}
              </button>
            );
          })}
        </div>

        <div className="cp-inset overflow-hidden">
          <label className="flex min-h-[52px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
              Valor (€)
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
              className="tabular-nums w-36 bg-transparent text-right text-[20px] font-bold outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>

          <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
              Data
            </span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-right text-[15px] font-semibold outline-none"
            />
          </label>

          <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
              Descrição
            </span>
            <input
              type="text"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Truckstop Lyon / Lavagem"
              className="flex-1 bg-transparent text-right text-[14px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>

          <div className="flex min-h-[54px] items-center justify-between gap-3 px-4 py-2">
            <div>
              <p className="text-[14px] font-semibold">
                Reembolsável pela empresa
              </p>
              <p className="text-[11px] text-[var(--ios-label-secondary)]">
                {reimbursable
                  ? 'Entra no total de reembolso'
                  : 'Despesa pessoal (sem reembolso)'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reimbursable}
              aria-label="Despesa reembolsável pela empresa"
              onClick={() => setReimbursable((prev) => !prev)}
              className="ios-switch"
            >
              <span className="ios-switch-thumb" />
            </button>
          </div>
        </div>

        {/* Foto do Recibo */}
        <div className="cp-inset flex items-center justify-between gap-3 px-4 py-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleReceiptChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-[42px] items-center gap-2 text-[14px] font-semibold text-[var(--ios-blue)]"
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
            {receiptThumbDataUrl ? 'Trocar Foto do Recibo' : 'Foto do Recibo'}
          </button>

          {receiptThumbDataUrl && (
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setLightboxState({
                    isOpen: true,
                    images: [
                      {
                        src: receiptFullDataUrl || receiptThumbDataUrl,
                        label: 'Foto do Recibo',
                      },
                    ],
                    initialIndex: 0,
                  })
                }
                aria-label="Visualizar recibo"
                className="overflow-hidden rounded-xl border ios-sep-border"
              >
                <img
                  src={receiptThumbDataUrl}
                  alt="Preview do recibo"
                  className="h-12 w-12 object-cover"
                />
              </button>
              <button
                type="button"
                aria-label="Remover foto do recibo"
                onClick={() => {
                  setReceiptFullDataUrl('');
                  setReceiptThumbDataUrl('');
                }}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ios-red)] text-white shadow-sm"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--ios-red)]/25 bg-[var(--ios-red)]/10 p-3 text-[13px] font-medium text-[var(--ios-red)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--ios-green)]/25 bg-[var(--ios-green)]/10 p-3 text-[13px] font-medium text-[var(--ios-green)]">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="min-h-[52px] w-full rounded-xl bg-[var(--ios-blue)] px-4 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[var(--ios-blue-hover)] active:scale-[0.99] disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Registrar Despesa'}
        </button>
      </form>

      {/* Histórico de Despesas */}
      <section className="space-y-2.5 pt-1">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Histórico ({filteredExpenses.length})
          </h3>
        </div>

        <div className="ios-segmented grid-cols-3">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'reimbursable', label: 'Reembolsáveis' },
            { id: 'personal', label: 'Pessoais' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              aria-selected={filterType === f.id}
              onClick={() => setFilterType(f.id)}
              className="ios-segmented-item"
            >
              {f.label}
            </button>
          ))}
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="ios-card p-8 text-center text-[13px] text-[var(--ios-label-secondary)]">
            <Receipt
              className="mx-auto mb-2 h-8 w-8 text-[var(--ios-label-tertiary)]"
              aria-hidden="true"
            />
            Nenhuma despesa registrada neste filtro.
          </div>
        ) : (
          filteredExpenses.map((item) => {
            const Icon = CATEGORY_ICONS[item.category] || Receipt;
            return (
              <article key={item.id} className="ios-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ios-blue)]/10 text-[var(--ios-blue)]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-bold text-[var(--ios-label)]">
                          {item.description ||
                            categoryLabels[item.category] ||
                            'Despesa'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="font-semibold text-[var(--ios-label-secondary)]">
                          {categoryLabels[item.category] || 'Outro'}
                        </span>
                        <span className="text-[var(--ios-label-tertiary)]">•</span>
                        <span className="text-[var(--ios-label-secondary)]">
                          {item.date}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            item.reimbursable
                              ? 'bg-[var(--ios-green)]/12 text-[var(--ios-green)]'
                              : 'bg-[var(--ios-orange)]/15 text-[#B45309] dark:text-[#F59E0B]'
                          }`}
                        >
                          {item.reimbursable ? 'Reembolsável' : 'Pessoal'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-[16px] font-bold text-[var(--ios-label)]">
                      {formatEuro(item.amount)}
                    </span>

                    {item.receiptThumbDataUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenReceiptLightbox(item)}
                        aria-label="Ampliar foto do recibo"
                        className="overflow-hidden rounded-lg border ios-sep-border"
                      >
                        <img
                          src={item.receiptThumbDataUrl}
                          alt="Recibo"
                          className="h-10 w-10 object-cover"
                        />
                      </button>
                    )}

                    <button
                      type="button"
                      aria-label="Apagar despesa"
                      onClick={() => setConfirmDeleteId(item.id)}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-[var(--ios-red)]/10 text-[var(--ios-red)]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      <ConfirmModal
        isOpen={Boolean(confirmDeleteId)}
        title="Apagar despesa?"
        message="Esta despesa e a foto do recibo serão removidas."
        confirmLabel="Apagar"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ImageLightbox
        isOpen={lightboxState.isOpen}
        images={lightboxState.images}
        initialIndex={lightboxState.initialIndex}
        onClose={() =>
          setLightboxState((prev) => ({ ...prev, isOpen: false }))
        }
      />
    </div>
  );
}
