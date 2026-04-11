'use client';

import { useState } from 'react';
import { X, Plus, Trash2, ChevronRight, ChevronLeft, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { CoCAcquisition } from '@/types';

interface Signer {
  name: string;
  email: string;
  role: string;
}

interface LOITerms {
  purchase_price: number;
  earnest_money: number;
  close_date: string;
  contingency_financing: boolean;
  contingency_inspection: boolean;
  contingency_appraisal: boolean;
  additional_terms: string;
  buying_entity: string;
}

interface LOIWizardProps {
  dealId: string;
  acquisition: CoCAcquisition;
  userName: string;
  userEmail: string;
  onClose: () => void;
  onSent: () => void;
}

const STEPS = ['Terms', 'Signers', 'Review'] as const;

function fmtCurrency(v: number) {
  return `$${Math.round(v).toLocaleString()}`;
}

// ── Step 1: Terms ─────────────────────────────────────────────────────────────

function TermsStep({ terms, onChange }: { terms: LOITerms; onChange: (t: LOITerms) => void }) {
  const set = <K extends keyof LOITerms>(k: K, v: LOITerms[K]) =>
    onChange({ ...terms, [k]: v });

  return (
    <div className="space-y-5">
      {/* Buying Entity */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
          Buying Entity <span className="font-normal text-slate-400">(optional — LLC or company name)</span>
        </label>
        <input
          type="text"
          value={terms.buying_entity}
          onChange={e => set('buying_entity', e.target.value)}
          placeholder="e.g. Acme Capital LLC (leave blank to use your name)"
          className="input w-full"
        />
      </div>

      {/* Offer Price + Earnest Money */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
            Offer Price
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              value={terms.purchase_price}
              onChange={e => set('purchase_price', Number(e.target.value))}
              className="input pl-7 w-full"
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Pre-filled from your deal analysis</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
            Earnest Money Deposit
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              value={terms.earnest_money}
              onChange={e => set('earnest_money', Number(e.target.value))}
              className="input pl-7 w-full"
            />
          </div>
        </div>
      </div>

      {/* Close Date */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
          Proposed Close Date
        </label>
        <input
          type="date"
          value={terms.close_date}
          onChange={e => set('close_date', e.target.value)}
          className="input w-full"
        />
      </div>

      {/* Contingencies */}
      <div>
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Contingencies</p>
        <p className="text-[10px] text-slate-400 -mt-1 mb-2">Fewer contingencies = stronger offer to the seller</p>
        <div className="space-y-2">
          {(
            [
              ['contingency_financing', 'Financing Contingency'],
              ['contingency_inspection', 'Inspection Contingency'],
              ['contingency_appraisal', 'Appraisal Contingency'],
            ] as [keyof LOITerms, string][]
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={terms[key] as boolean}
                onChange={e => set(key, e.target.checked)}
                className="w-4 h-4 rounded accent-primary-600"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Additional Terms */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
          Additional Terms <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          value={terms.additional_terms}
          onChange={e => set('additional_terms', e.target.value)}
          placeholder="Appliances to convey, leaseback request, AS-IS acceptance, etc."
          rows={3}
          className="input w-full resize-none"
        />
      </div>
    </div>
  );
}

// ── Step 2: Signers ───────────────────────────────────────────────────────────

function SignersStep({
  signers,
  onChange,
  notifyEmails,
  onNotifyChange,
}: {
  signers: Signer[];
  onChange: (s: Signer[]) => void;
  notifyEmails: string;
  onNotifyChange: (v: string) => void;
}) {
  const update = (i: number, field: keyof Signer, val: string) => {
    const next = signers.map((s, idx) => idx === i ? { ...s, [field]: val } : s);
    onChange(next);
  };
  const add = () => onChange([...signers, { name: '', email: '', role: `Signer ${signers.length + 1}` }]);
  const remove = (i: number) => onChange(signers.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Each signer receives an email from DocuSeal with a link to sign. No app account required.
      </p>

      <div className="space-y-3">
        {signers.map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {i === 0 ? 'You (Buyer)' : `Signer ${i + 1}`}
              </span>
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Full name"
                value={s.name}
                onChange={e => update(i, 'name', e.target.value)}
                disabled={i === 0}
                className="input text-sm disabled:opacity-60"
              />
              <input
                type="email"
                placeholder="Email address"
                value={s.email}
                onChange={e => update(i, 'email', e.target.value)}
                disabled={i === 0}
                className="input text-sm disabled:opacity-60"
              />
            </div>
            <input
              type="text"
              placeholder="Role (e.g. Buyer, Co-Buyer, Partner)"
              value={s.role}
              onChange={e => update(i, 'role', e.target.value)}
              className="input text-sm w-full"
            />
          </div>
        ))}
      </div>

      {signers.length < 4 && (
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium transition-colors"
        >
          <Plus size={13} />
          Add another signer
        </button>
      )}

      <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
          Email signed copy to{' '}
          <span className="font-normal text-slate-400">(optional — comma-separated)</span>
        </label>
        <input
          type="text"
          value={notifyEmails}
          onChange={e => onNotifyChange(e.target.value)}
          placeholder="attorney@firm.com, partner@example.com"
          className="input w-full text-sm"
        />
        <p className="text-[11px] text-slate-400 mt-1">
          These people receive the signed PDF from your app once all parties have signed.
        </p>
      </div>
    </div>
  );
}

// ── Step 3: Review ────────────────────────────────────────────────────────────

function ReviewStep({
  acquisition,
  terms,
  signers,
  notifyEmailsRaw,
}: {
  acquisition: CoCAcquisition;
  terms: LOITerms;
  signers: Signer[];
  notifyEmailsRaw: string;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Property</p>
        <p className="font-medium text-slate-800 dark:text-slate-200">
          {acquisition.propertyAddress || 'Address not specified'}
        </p>
      </div>

      <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Terms</p>
        <div className="grid grid-cols-2 gap-2">
          <span className="text-xs text-slate-500">Purchase Price</span>
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 text-right">{fmtCurrency(terms.purchase_price)}</span>
          <span className="text-xs text-slate-500">Earnest Money</span>
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 text-right">{fmtCurrency(terms.earnest_money)}</span>
          <span className="text-xs text-slate-500">Close Date</span>
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 text-right">{terms.close_date}</span>
          <span className="text-xs text-slate-500">Contingencies</span>
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 text-right">
            {[
              terms.contingency_financing && 'Financing',
              terms.contingency_inspection && 'Inspection',
              terms.contingency_appraisal && 'Appraisal',
            ].filter(Boolean).join(', ') || 'None'}
          </span>
        </div>
        {terms.additional_terms && (
          <p className="text-xs text-slate-500 mt-2 border-t border-slate-200 dark:border-slate-600 pt-2">
            {terms.additional_terms}
          </p>
        )}
      </div>

      <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Signers</p>
        {signers.map((s, i) => (
          <div key={i} className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{s.name}</p>
              <p className="text-[11px] text-slate-500">{s.email}</p>
            </div>
            <span className="text-[10px] bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
              {s.role}
            </span>
          </div>
        ))}
      </div>

      {notifyEmailsRaw.trim() && (
        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Notify on completion</p>
          <p className="text-xs text-slate-700 dark:text-slate-300">{notifyEmailsRaw}</p>
        </div>
      )}

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Each signer receives a secure link to sign via DocuSeal.
        {notifyEmailsRaw.trim()
          ? ' The signed PDF will also be emailed to the addresses above once all parties have signed.'
          : ''}
      </p>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function LOIWizard({ dealId, acquisition, userName, userEmail, onClose, onSent }: LOIWizardProps) {
  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultCloseDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  })();

  const [terms, setTerms] = useState<LOITerms>({
    purchase_price: acquisition.purchasePrice,
    earnest_money: Math.round(acquisition.purchasePrice * 0.01 / 1000) * 1000 || 1000,
    close_date: defaultCloseDate,
    contingency_financing: true,
    contingency_inspection: true,
    contingency_appraisal: false,
    additional_terms: '',
    buying_entity: '',
  });

  const [signers, setSigners] = useState<Signer[]>([
    { name: userName, email: userEmail, role: 'Buyer' },
  ]);

  // Comma-separated notify emails (raw string, parsed on send)
  const [notifyEmailsRaw, setNotifyEmailsRaw] = useState('');

  const canAdvance = () => {
    if (step === 0) return terms.purchase_price > 0 && terms.earnest_money >= 0 && !!terms.close_date;
    if (step === 1) return signers.every(s => s.name.trim() && s.email.trim() && s.role.trim());
    return true;
  };

  async function handleSend() {
    setSending(true);
    setError(null);
    const notify_emails = notifyEmailsRaw
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);
    try {
      await api.createLOI(dealId, { terms, signers, notify_emails });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send LOI. Please try again.');
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Send Letter of Intent</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {acquisition.propertyAddress || 'Deal'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 px-5 pb-4 shrink-0">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold transition-colors ${
                i < step ? 'bg-primary-600 text-white' :
                i === step ? 'bg-primary-600 text-white' :
                'bg-slate-200 dark:bg-slate-600 text-slate-400'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${i === step ? 'text-slate-800 dark:text-slate-200 font-medium' : 'text-slate-400'}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-slate-200 dark:bg-slate-600 mx-1" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-5 pb-2 overflow-y-auto flex-1">
          {step === 0 && <TermsStep terms={terms} onChange={setTerms} />}
          {step === 1 && <SignersStep signers={signers} onChange={setSigners} notifyEmails={notifyEmailsRaw} onNotifyChange={setNotifyEmailsRaw} />}
          {step === 2 && <ReviewStep acquisition={acquisition} terms={terms} signers={signers} notifyEmailsRaw={notifyEmailsRaw} />}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 shrink-0 space-y-2">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex items-center gap-2 justify-between">
            <button
              type="button"
              onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              <ChevronLeft size={15} />
              {step === 0 ? 'Cancel' : 'Back'}
            </button>

            {step < 2 ? (
              <button
                type="button"
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {sending ? 'Sending…' : (
                  <>
                    <Send size={14} />
                    Send for Signature
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
