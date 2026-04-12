'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X, Send, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

function getModule(pathname: string): { key: 'deal_analyzer' | 'reps'; label: string } {
  if (pathname.startsWith('/deal-analyzer')) return { key: 'deal_analyzer', label: 'Deal Analyzer' };
  return { key: 'reps', label: 'REPS Tracker' };
}

export function FeedbackButton() {
  const pathname = usePathname();
  const module = getModule(pathname);

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await api.submitFeedback(module.key, message.trim());
      setSubmitted(true);
      setMessage('');
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
      }, 2000);
    } catch {
      toast.error('Failed to send feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating button — sits above mobile nav (pb-16) and above desktop footer */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Send feedback"
        className={`fixed right-4 lg:right-6 z-[60] w-12 h-12 rounded-full bg-primary-600 hover:bg-primary-700 text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center ${
          pathname.startsWith('/deal-analyzer/') && pathname !== '/deal-analyzer/'
            ? 'bottom-36 lg:bottom-20'
            : 'bottom-20 lg:bottom-6'
        }`}
      >
        <MessageCircle size={20} />
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />

          {/* Panel */}
          <div className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">Send Feedback</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  You're in <span className="font-semibold text-primary-600 dark:text-primary-400">{module.label}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {submitted ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <CheckCircle2 size={36} className="text-secondary-500" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Thanks for your feedback!</p>
                  <p className="text-xs text-slate-400">We'll review it shortly.</p>
                </div>
              ) : (
                <>
                  <textarea
                    autoFocus
                    rows={5}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Describe an issue, suggest a feature, or share any thoughts…"
                    className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-primary-400 transition"
                  />
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || !message.trim()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                  >
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    {submitting ? 'Sending…' : 'Send Feedback'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
