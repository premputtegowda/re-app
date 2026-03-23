'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Home, FileText, CheckCircle, Loader2, AlertCircle, Brain, Lightbulb, ShieldCheck, Paperclip, X, Sparkles, RotateCcw, Pencil, Upload, CheckCircle2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAttachmentStore, type PendingAttachment } from '@/lib/attachmentStore';
import { uploadFileToR2 } from '@/lib/r2Api';
import { Button } from '@/components/UI/Button';
import { Input } from '@/components/UI/Input';
import { Card } from '@/components/UI/Card';
import { validateHoursEntry, getFieldError } from '@/utils/validationUtils';
import { getTodayDate } from '@/utils/dateUtils';
import type { HoursEntryFormData, ClassificationResult } from '@/types';
import { getCachedClassification, setCachedClassification } from '@/utils/classificationCache';
import { labelFromUrl } from '@/utils/attachmentUtils';

const QUICK_HOURS = [1, 2, 3, 4, 6, 8];
const QUICK_MINUTES = [15, 30, 45];
const EMPTY_ATTACHMENTS: import('@/lib/attachmentStore').PendingAttachment[] = [];

interface TimeFormBodyProps {
  formData: HoursEntryFormData;
  setFormData: (data: HoursEntryFormData) => void;
  errors: { field: string; message: string }[];
}

function TimeFormBody({ formData, setFormData, errors }: TimeFormBodyProps) {
  return (
    <>
      <div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Quick select (hours):</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_HOURS.map((h) => (
            <button
              key={h}
              onClick={() => setFormData({ ...formData, hours: formData.hours === h ? 0 : h })}
              className={`px-4 py-2 rounded-lg border-2 transition-all ${
                formData.hours === h
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                  : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500 text-slate-700 dark:text-slate-300'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Quick select (minutes):</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_MINUTES.map((m) => (
            <button
              key={m}
              onClick={() => setFormData({ ...formData, minutes: formData.minutes === m ? 0 : m })}
              className={`px-4 py-2 rounded-lg border-2 transition-all ${
                formData.minutes === m
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                  : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500 text-slate-700 dark:text-slate-300'
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">Or enter custom time:</p>
        <div className="grid grid-cols-2 gap-4">
          <Input
            type="text"
            inputMode="numeric"
            label="Hours"
            placeholder="0"
            value={formData.hours === 0 ? '' : formData.hours}
            onChange={(e) => setFormData({ ...formData, hours: parseInt(e.target.value) || 0 })}
            error={getFieldError(errors, 'hours')}
          />
          <Input
            type="text"
            inputMode="numeric"
            label="Minutes"
            placeholder="0"
            value={formData.minutes === 0 ? '' : formData.minutes}
            onChange={(e) => setFormData({ ...formData, minutes: parseInt(e.target.value) || 0 })}
            error={getFieldError(errors, 'minutes')}
          />
        </div>
      </div>
      <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
        <Input
          type="date"
          label="Date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          error={getFieldError(errors, 'date')}
          fullWidth
        />
      </div>
    </>
  );
}

function SummaryBar({
  icon,
  label,
  value,
  onEdit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-primary-400 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-all group text-left"
    >
      <span className="text-slate-400 dark:text-slate-500 group-hover:text-primary-500 transition-colors shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">{label}</p>
        <p className="text-sm text-slate-800 dark:text-slate-200 font-semibold truncate">{value}</p>
      </div>
      <Pencil size={14} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-500 transition-colors shrink-0" />
    </button>
  );
}

export function ChatLikeEntry() {
  const properties = useStore((s) => s.properties);
  const categories = useStore((s) => s.categories);
  const router = useRouter();
  const addEntry = useStore((s) => s.addEntry);
  const addCategory = useStore((s) => s.addCategory);
  const patchEntryAttachments = useStore((s) => s.patchEntryAttachments);

  const CATEGORY_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#14b8a6', '#f97316', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];

  const getUnusedCategoryColor = () => {
    const usedColors = new Set(categories.map((c) => c.color));
    return CATEGORY_COLORS.find((c) => !usedColors.has(c)) ?? CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length];
  };

  const [step, setStep] = useState(1);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [saveMode, setSaveMode] = useState<'done' | 'another'>('done');
  const [errors, setErrors] = useState<any[]>([]);

  // AI classification state
  const [classificationResult, setClassificationResult] = useState<ClassificationResult | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);

  // Category selection — text input (AI-suggested, user-editable) + optional existing-category id
  const [categoryInput, setCategoryInput] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedType, setSelectedType] = useState<'material' | 'non-material'>('material');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  // Description toggle: original vs AI refined
  const [useRefinedDescription, setUseRefinedDescription] = useState(true);
  const [refinedDescription, setRefinedDescription] = useState('');
  // The pristine AI output — frozen after classification, never edited by user
  const [originalAiDescription, setOriginalAiDescription] = useState('');
  // Pending file attachments
  const ATTACH_KEY = 'pending-entry';
  const pendingAttachments = useAttachmentStore((s) => s.attachments[ATTACH_KEY] ?? EMPTY_ATTACHMENTS);
  const addFiles = useAttachmentStore((s) => s.addFiles);

  const updateAttachment = useAttachmentStore((s) => s.updateAttachment);
  const removeAttachment = useAttachmentStore((s) => s.removeAttachment);
  const clearAttachKey = useAttachmentStore((s) => s.clearKey);

  const handleAddFiles = async (files: File[]) => {
    addFiles(ATTACH_KEY, files);
    const currentCount = pendingAttachments.length;
    for (let i = 0; i < files.length; i++) {
      const idx = currentCount + i;
      updateAttachment(ATTACH_KEY, idx, { status: 'uploading' });
      try {
        const result = await uploadFileToR2(files[i], 'pending');
        updateAttachment(ATTACH_KEY, idx, { status: 'uploaded', r2Key: result.key, fileUrl: '', errorMsg: '' });
      } catch (e) {
        updateAttachment(ATTACH_KEY, idx, { status: 'error', errorMsg: e instanceof Error ? e.message : 'Upload failed' });
      }
    }
  };

  // Derived: AI recommended category name (existing or suggested new)
  const aiCategoryName = classificationResult?.category_name ?? classificationResult?.suggested_new_category ?? '';

  // All category options for chip selector, including AI-suggested new one
  const allCategoryOptions = useMemo(() => {
    const aiName = classificationResult?.category_name ?? classificationResult?.suggested_new_category ?? '';
    const opts = categories.map((c) => ({
      id: c.id,
      name: c.name,
      isAiRecommended: !!aiName && c.name.toLowerCase() === aiName.toLowerCase(),
      isNew: false,
    }));
    if (classificationResult?.suggested_new_category && !classificationResult.category_name) {
      const exists = categories.some(
        (c) => c.name.toLowerCase() === classificationResult.suggested_new_category!.toLowerCase()
      );
      if (!exists) {
        opts.unshift({
          id: `__new__${classificationResult.suggested_new_category}`,
          name: classificationResult.suggested_new_category,
          isAiRecommended: true,
          isNew: true,
        });
      }
    }
    return opts;
  }, [categories, classificationResult]);

  // True when the user has edited the AI-refined description (working copy differs from original AI output)
  const isAiDescriptionModified = !!originalAiDescription && refinedDescription !== originalAiDescription;

  const isCategoryOverridden =
    !!classificationResult &&
    !!aiCategoryName &&
    categoryInput.trim().toLowerCase() !== aiCategoryName.toLowerCase();

  const isTypeOverridden = !!classificationResult && selectedType !== classificationResult.type;

  const [formData, setFormData] = useState<HoursEntryFormData>({
    date: getTodayDate(),
    hours: 0,
    minutes: 0,
    category: '',
    property: '',
    description: '',
    type: 'material',
  });

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Reset form or redirect after successful submission
  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => {
        if (saveMode === 'done') {
          router.push('/dashboard');
          return;
        }
        setShowSuccess(false);
        setStep(1);
        setFormData({
          date: getTodayDate(),
          hours: 0,
          minutes: 0,
          category: '',
          property: '',
          description: '',
          type: 'material',
        });
        setErrors([]);
        setClassificationResult(null);
        setClassificationError(null);
        setCategoryInput('');
        setSelectedCategoryId('');
        setSelectedType('material');
        setIsSubmitting(false);
        setUseRefinedDescription(true);
        setRefinedDescription('');
        setOriginalAiDescription('');
        clearAttachKey(ATTACH_KEY);
        setEditingStep(null);
        setIsCreatingCategory(false);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [showSuccess, saveMode]);

  const handlePropertySelect = (propertyId: string) => {
    setFormData({ ...formData, property: propertyId });
    if (editingStep === 1) {
      setEditingStep(null);
    } else {
      setStep(2);
    }
  };

  const handleTimeSubmit = () => {
    if (formData.hours === 0 && formData.minutes === 0) {
      setErrors([{ field: 'hours', message: 'Please enter at least some time' }]);
      return;
    }
    setErrors([]);
    if (editingStep === 2) {
      setEditingStep(null);
    } else {
      setStep(3);
      setTimeout(() => {
        descriptionRef.current?.focus();
      }, 100);
    }
  };

  const applyClassificationResult = useCallback(async (result: ClassificationResult, applyDescription = true) => {
    setClassificationResult(result);
    const aiText = result.refined_description || '';
    setRefinedDescription(aiText);
    setOriginalAiDescription(aiText);
    if (applyDescription) {
      setUseRefinedDescription(!!aiText);
    } else {
      setUseRefinedDescription(false);
    }
    setSelectedType(result.type);
    const name = result.category_name ?? result.suggested_new_category ?? '';
    setCategoryInput(name);
    const match = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (match) {
      setSelectedCategoryId(match.id);
    } else if (name) {
      // Auto-create the category immediately
      const color = getUnusedCategoryColor();
      setIsCreatingCategory(true);
      try {
        await addCategory({ name, color });
        const created = useStore.getState().categories.find(
          (c) => c.name.toLowerCase() === name.toLowerCase()
        );
        if (created) {
          setSelectedCategoryId(created.id);
        }
      } catch {
        setSelectedCategoryId(`__new__${name}`);
      } finally {
        setIsCreatingCategory(false);
      }
    } else {
      setSelectedCategoryId('');
    }
  }, [categories, addCategory]);

  const runClassification = useCallback(async (description: string, applyDescription = true) => {
    if (!description.trim()) return;
    const cached = getCachedClassification(description);
    if (cached) {
      await applyClassificationResult(cached, applyDescription);
      return;
    }
    setIsClassifying(true);
    setClassificationError(null);
    try {
      const result: ClassificationResult = await api.classifyActivity(description);
      // Only cache genuine results, not fallbacks
      if (result.audit_strength !== 'low' || result.refined_title !== 'Unclassified Activity') {
        setCachedClassification(description, result);
      }
      await applyClassificationResult(result, applyDescription);
    } catch (err: any) {
      setClassificationError(err.message || 'Classification failed. Please select manually.');
      const firstCat = categories.length > 0 ? categories[0] : null;
      setCategoryInput(firstCat?.name ?? '');
      setSelectedCategoryId(firstCat?.id ?? '');
    } finally {
      setIsClassifying(false);
    }
  }, [categories, applyClassificationResult]);

  // Re-classify when description changes after a classification has already been done
  // but not while the user is actively editing inline (they'll trigger it on Done)
  useEffect(() => {
    if (!classificationResult || !formData.description.trim() || editingStep === 3) return;
    const timer = setTimeout(() => {
      runClassification(formData.description, false);
    }, 800);
    return () => clearTimeout(timer);
  }, [formData.description]);

  const handleDescriptionNext = async () => {
    if (!formData.description.trim()) {
      setErrors([{ field: 'description', message: 'Please describe your activity' }]);
      return;
    }
    setErrors([]);
    await runClassification(formData.description);
    setStep(4);
  };

  const handleStep3InlineDone = async () => {
    if (!formData.description.trim()) {
      setErrors([{ field: 'description', message: 'Please describe your activity' }]);
      return;
    }
    setErrors([]);
    setEditingStep(null);
    await runClassification(formData.description, true);
  };

  const handleCategorySelect = async (option: { id: string; name: string; isNew: boolean }) => {
    if (option.isNew) {
      const color = getUnusedCategoryColor();
      setIsCreatingCategory(true);
      try {
        await addCategory({ name: option.name, color });
        const created = useStore.getState().categories.find((c) => c.name === option.name);
        if (created) {
          setSelectedCategoryId(created.id);
          setCategoryInput(created.name);
        }
      } catch {
        setErrors([{ field: 'general', message: 'Failed to create category' }]);
      } finally {
        setIsCreatingCategory(false);
      }
    } else {
      setSelectedCategoryId(option.id);
      setCategoryInput(option.name);
    }
  };

  const handleRevertCategory = async () => {
    if (!classificationResult) return;
    const targetName = classificationResult.category_name ?? classificationResult.suggested_new_category;
    if (!targetName) return;
    const existing = categories.find((c) => c.name.toLowerCase() === targetName.toLowerCase());
    if (existing) {
      setSelectedCategoryId(existing.id);
      setCategoryInput(existing.name);
    } else {
      const color = getUnusedCategoryColor();
      setIsCreatingCategory(true);
      try {
        await addCategory({ name: targetName, color });
        const created = useStore.getState().categories.find((c) => c.name === targetName);
        if (created) {
          setSelectedCategoryId(created.id);
          setCategoryInput(created.name);
        }
      } catch {
        setErrors([{ field: 'general', message: 'Failed to create category' }]);
      } finally {
        setIsCreatingCategory(false);
      }
    }
  };

  const handleRevertType = () => {
    if (classificationResult) setSelectedType(classificationResult.type);
  };

  const handleSubmit = async (mode: 'done' | 'another' = 'done') => {
    setSaveMode(mode);
    const trimmedName = categoryInput.trim();
    if (!trimmedName) {
      setErrors([{ field: 'category', message: 'Please enter or select a category' }]);
      return;
    }

    setIsSubmitting(true);
    setErrors([]);

    let categoryId = selectedCategoryId;

    // Create the category on the fly if it doesn't match an existing one
    if (!categoryId) {
      const color = getUnusedCategoryColor();
      try {
        await addCategory({ name: trimmedName, color });
        const created = useStore.getState().categories.find(
          (c) => c.name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (!created) {
          setErrors([{ field: 'general', message: `Failed to find created category "${trimmedName}". Please select a category manually.` }]);
          setIsSubmitting(false);
          return;
        }
        categoryId = created.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create category';
        setErrors([{ field: 'general', message: msg }]);
        setIsSubmitting(false);
        return;
      }
    }

    const activeDescription = useRefinedDescription && refinedDescription
      ? refinedDescription
      : formData.description;

    // Resolve the AI-recommended category ID (distinct from user's selection)
    const aiRecommendedCategoryId = classificationResult
      ? useStore.getState().categories.find(
          (c) => c.name.toLowerCase() === (classificationResult.category_name ?? classificationResult.suggested_new_category ?? '').toLowerCase()
        )?.id ?? undefined
      : undefined;

    const finalFormData: HoursEntryFormData = {
      ...formData,
      description: activeDescription,
      raw_description: formData.description,
      refined_description: originalAiDescription || undefined,
      ai_category_id: aiRecommendedCategoryId,
      ai_type: classificationResult?.type,
      category: categoryId,
      type: selectedType,
    };

    const validation = validateHoursEntry(finalFormData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      setIsSubmitting(false);
      return;
    }

    try {
      const createdEntry = await addEntry(finalFormData);

      // Save attachments that have been uploaded to R2 or have a manual URL
      const attachsToSave = pendingAttachments.filter(
        (a) => a.r2Key.trim() || a.manualUrl.trim()
      );
      if (attachsToSave.length > 0) {
        const results = await Promise.allSettled(
          attachsToSave.map((a) =>
            api.createAttachment(createdEntry.id, {
              file_ref: a.r2Key || 'manual',
              attachment_url: a.manualUrl || '',
              original_filename: a.label || a.manualUrl,
              content_type: a.file?.type || 'application/octet-stream',
              file_size: a.file?.size ?? 0,
            })
          )
        );
        const saved = results
          .filter((r): r is PromiseFulfilledResult<import('@/types').Attachment> => r.status === 'fulfilled')
          .map((r) => r.value);
        if (saved.length > 0) {
          patchEntryAttachments(createdEntry.id, saved);
        }
      }

      clearAttachKey(ATTACH_KEY);
      setShowSuccess(true);
    } catch (err) {
      setErrors([{ field: 'general', message: String(err instanceof Error ? err.message : err) }]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const auditStrengthBadge = (strength: string) => {
    if (strength === 'high')   return { label: 'High Audit Strength',   classes: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' };
    if (strength === 'medium') return { label: 'Medium Audit Strength', classes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' };
    return                            { label: 'Low Audit Strength',    classes: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' };
  };

  if (showSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl mx-auto mt-8"
      >
        <Card>
          <div className="text-center py-12">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.2 }}
              className="inline-flex items-center justify-center w-16 h-16 bg-secondary-100 dark:bg-secondary-900/30 rounded-full mb-4"
            >
              <CheckCircle className="text-secondary-600 dark:text-secondary-400" size={32} />
            </motion.div>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Hours Logged!</h3>
            <p className="text-slate-600 dark:text-slate-400">Your entry has been saved successfully.</p>
          </div>
        </Card>
      </motion.div>
    );
  }

  // Derived display values for summary bars
  const selectedProperty = properties.find((p) => p.id === formData.property);
  const timeLabel = formData.hours > 0 && formData.minutes > 0
    ? `${formData.hours}h ${formData.minutes}m`
    : formData.hours > 0
    ? `${formData.hours}h`
    : `${formData.minutes}m`;
  const descriptionPreview = formData.description.length > 80
    ? formData.description.slice(0, 80) + '…'
    : formData.description;

  return (
    <div className="max-w-2xl mx-auto mt-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Log Your Hours</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">Describe what you did — AI will classify it for you</p>
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors mt-0.5 shrink-0"
          >
            <X size={15} />
            Cancel
          </button>
        </div>
      </motion.div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map((s) => (
          <motion.div
            key={s}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: s * 0.1 }}
            className={`h-2 flex-1 rounded-full transition-all ${
              s <= step ? 'bg-primary-600' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          />
        ))}
      </div>

      <div className="space-y-3">

        {/* ── Step 1 summary bar (shown when step > 1) ── */}
        <AnimatePresence>
          {step > 1 && (
            <motion.div
              key="summary-1"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {editingStep === 1 ? (
                <Card>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Home className="text-primary-600 dark:text-primary-400" size={20} />
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Which property?</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {properties.map((property, index) => (
                        <motion.button
                          key={property.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.04 }}
                          onClick={() => handlePropertySelect(property.id)}
                          className={`text-left p-4 border-2 rounded-lg transition-all ${
                            formData.property === property.id
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-slate-200 dark:border-slate-600 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                          }`}
                        >
                          <p className="font-medium text-slate-900 dark:text-white">{property.name}</p>
                          {property.address && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{property.address}</p>
                          )}
                        </motion.button>
                      ))}
                    </div>
                    <Button variant="secondary" onClick={() => setEditingStep(null)} fullWidth>
                      Cancel
                    </Button>
                  </div>
                </Card>
              ) : (
                <SummaryBar
                  icon={<Home size={18} />}
                  label="Property"
                  value={selectedProperty?.name ?? '—'}
                  onEdit={() => setEditingStep(1)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 2 summary bar (shown when step > 2) ── */}
        <AnimatePresence>
          {step > 2 && (
            <motion.div
              key="summary-2"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {editingStep === 2 ? (
                <Card>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Clock className="text-primary-600 dark:text-primary-400" size={20} />
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">How long?</h3>
                    </div>
                    <TimeFormBody formData={formData} setFormData={setFormData} errors={errors} />
                    <div className="flex gap-3 pt-2">
                      <Button variant="secondary" onClick={() => setEditingStep(null)} fullWidth>
                        Cancel
                      </Button>
                      <Button onClick={handleTimeSubmit} fullWidth>
                        Done
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <SummaryBar
                  icon={<Clock size={18} />}
                  label="Time & Date"
                  value={`${timeLabel} · ${formData.date}`}
                  onEdit={() => setEditingStep(2)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 3 inline edit (only shown when user taps edit on the description) ── */}
        <AnimatePresence>
          {step > 3 && editingStep === 3 && (
            <motion.div
              key="summary-3"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {editingStep === 3 ? (
                <Card>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                      <FileText className="text-primary-600 dark:text-primary-400" size={20} />
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">What did you do?</h3>
                    </div>
                    <div>
                      <textarea
                        ref={descriptionRef}
                        rows={4}
                        maxLength={2000}
                        placeholder="e.g. Met with contractor to review kitchen renovation quote…"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                      />
                      <div className="flex justify-between mt-1">
                        {getFieldError(errors, 'description') ? (
                          <p className="text-sm text-red-500">{getFieldError(errors, 'description')}</p>
                        ) : (
                          <span />
                        )}
                        <p className="text-xs text-slate-400">{formData.description.length}/2000</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button variant="secondary" onClick={() => setEditingStep(null)} fullWidth>
                        Cancel
                      </Button>
                      <Button onClick={handleStep3InlineDone} fullWidth disabled={isClassifying}>
                        {isClassifying ? (
                          <span className="flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            Classifying…
                          </span>
                        ) : (
                          'Done'
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <SummaryBar
                  icon={<FileText size={18} />}
                  label="Description"
                  value={descriptionPreview || '—'}
                  onEdit={() => setEditingStep(3)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Active step ── */}
        <AnimatePresence mode="wait">

          {/* Step 1: Select Property */}
          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Home className="text-primary-600 dark:text-primary-400" size={24} />
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Which property?</h3>
                  </div>
                  {properties.length === 0 ? (
                    <div className="text-center py-10 space-y-3">
                      <Home className="mx-auto text-slate-300 dark:text-slate-600" size={36} />
                      <p className="text-slate-600 dark:text-slate-400 font-medium">No properties added yet</p>
                      <p className="text-sm text-slate-500 dark:text-slate-500">Add your first property in Settings before logging hours.</p>
                      <button
                        onClick={() => router.push('/settings#properties')}
                        className="mt-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Go to Settings
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {properties.map((property, index) => (
                        <motion.button
                          key={property.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          onClick={() => handlePropertySelect(property.id)}
                          className="text-left p-4 border-2 border-slate-200 dark:border-slate-600 rounded-lg hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all"
                        >
                          <p className="font-medium text-slate-900 dark:text-white">{property.name}</p>
                          {property.address && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{property.address}</p>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          )}

          {/* Step 2: Enter Time & Date */}
          {step === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Clock className="text-primary-600 dark:text-primary-400" size={24} />
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">How long?</h3>
                  </div>
                  <TimeFormBody formData={formData} setFormData={setFormData} errors={errors} />
                  <Button onClick={handleTimeSubmit} fullWidth>
                    Next
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Step 3: Describe Activity */}
          {step === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <FileText className="text-primary-600 dark:text-primary-400" size={24} />
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">What did you do?</h3>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Activity description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      ref={descriptionRef}
                      rows={4}
                      maxLength={2000}
                      placeholder="e.g. Met with contractor to review kitchen renovation quote, walked the unit and documented needed repairs..."
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                    />
                    <div className="flex justify-between mt-1">
                      {getFieldError(errors, 'description') ? (
                        <p className="text-sm text-red-500">{getFieldError(errors, 'description')}</p>
                      ) : (
                        <span />
                      )}
                      <p className="text-xs text-slate-400">{formData.description.length}/2000</p>
                    </div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 flex gap-2">
                    <Brain className="text-blue-500 shrink-0 mt-0.5" size={16} />
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      AI will automatically classify the category and participation type based on your description.
                    </p>
                  </div>
                  <Button onClick={handleDescriptionNext} fullWidth disabled={isClassifying}>
                    {isClassifying ? (
                      <span className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        Classifying...
                      </span>
                    ) : (
                      'Next'
                    )}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Step 4: Review AI Classification */}
          {step === 4 && (
            <motion.div
              key="step-4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Brain className="text-primary-600 dark:text-primary-400" size={24} />
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Review & Submit</h3>
                  </div>

                  {/* Classification error banner */}
                  {classificationError && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 flex gap-2">
                      <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={16} />
                      <p className="text-sm text-amber-700 dark:text-amber-300">{classificationError}</p>
                    </div>
                  )}

                  {/* Non-material audit risk warning */}
                  {selectedType === 'non-material' && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex gap-2">
                      <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                      <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                        High Audit Risk — this activity may not count toward the 750-hour REPS requirement.
                      </p>
                    </div>
                  )}

                  {/* Description — toggle between Your original (editable) and AI refined (read-only) */}
                  <div>
                    {/* Toggle — only shown when AI refined is available */}
                    {refinedDescription && (
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Activity Description <span className="text-red-500">*</span>
                        </label>
                        <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs">
                          <button
                            type="button"
                            onClick={() => setUseRefinedDescription(false)}
                            className={`px-3 py-1 transition-colors ${!useRefinedDescription ? 'bg-primary-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                          >
                            Your original
                          </button>
                          <button
                            type="button"
                            onClick={() => setUseRefinedDescription(true)}
                            className={`px-3 py-1 transition-colors ${useRefinedDescription ? 'bg-primary-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                          >
                            AI refined
                          </button>
                        </div>
                      </div>
                    )}

                    {!refinedDescription && (
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                        Activity Description <span className="text-red-500">*</span>
                      </label>
                    )}

                    {/* Your original — editable, shown when toggle is "Your original" or no AI yet */}
                    {!useRefinedDescription && (
                      <>
                        <textarea
                          rows={4}
                          maxLength={2000}
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none text-sm"
                        />
                        {refinedDescription && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">Your original will be used for audit.</p>
                        )}
                      </>
                    )}

                    {/* AI refined — read-only, shown when toggle is "AI refined" */}
                    {useRefinedDescription && refinedDescription && (
                      <>
                        <textarea
                          rows={4}
                          readOnly
                          value={refinedDescription}
                          className="w-full px-3 py-2 border border-primary-300 dark:border-primary-600 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 resize-none text-sm cursor-default"
                        />
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">AI refined will be used for audit.</p>
                      </>
                    )}

                    {getFieldError(errors, 'description') && (
                      <p className="text-xs text-red-500 mt-1">{getFieldError(errors, 'description')}</p>
                    )}
                  </div>

                  {/* AI Classification card */}
                  <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 space-y-4">
                    {classificationResult && !classificationError && (
                      <>
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="text-primary-500 shrink-0" size={16} />
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            AI Classification
                          </p>
                        </div>
                        {classificationResult.refined_title && (
                          <p className="font-semibold text-slate-900 dark:text-white text-sm leading-snug">
                            {classificationResult.refined_title}
                          </p>
                        )}
                      </>
                    )}

                    {/* Category chips */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Category</label>
                        {isCategoryOverridden && (
                          <button
                            type="button"
                            onClick={handleRevertCategory}
                            disabled={isCreatingCategory}
                            className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                          >
                            <RotateCcw size={10} />
                            Revert to AI pick
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {allCategoryOptions.map((option) => {
                          const isSelected =
                            option.id === selectedCategoryId ||
                            (!selectedCategoryId && option.name.toLowerCase() === categoryInput.toLowerCase());
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => handleCategorySelect(option)}
                              disabled={isCreatingCategory}
                              className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium transition-all border-2 disabled:opacity-60 ${
                                isSelected
                                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                  : option.isAiRecommended
                                  ? 'border-dashed border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-primary-400 dark:hover:border-primary-500'
                                  : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-primary-300 dark:hover:border-primary-500'
                              }`}
                            >
                              {option.name}
                              {option.isNew && <span className="text-xs opacity-60 ml-0.5">· new</span>}
                            </button>
                          );
                        })}
                        {allCategoryOptions.length === 0 && (
                          <p className="text-xs text-slate-400 dark:text-slate-500">No categories yet — add one in Settings.</p>
                        )}
                      </div>
                      {getFieldError(errors, 'category') && (
                        <p className="text-xs text-red-500 mt-1">{getFieldError(errors, 'category')}</p>
                      )}
                    </div>

                    {/* Participation Type chips */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Participation Type</label>
                        {isTypeOverridden && (
                          <button
                            type="button"
                            onClick={handleRevertType}
                            className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            <RotateCcw size={10} />
                            Revert to AI pick
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {(['material', 'non-material'] as const).map((type) => {
                          const isSelected = selectedType === type;
                          const isAiPick = !!classificationResult && classificationResult.type === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setSelectedType(type)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border-2 ${
                                isSelected
                                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                  : isAiPick
                                  ? 'border-dashed border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-primary-400 dark:hover:border-primary-500'
                                  : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-primary-300'
                              }`}
                            >
                              {type === 'material' ? 'Material' : 'Non-Material'}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Audit info */}
                    {classificationResult && !classificationError && (
                      <>
                        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${auditStrengthBadge(classificationResult.audit_strength).classes}`}>
                          {auditStrengthBadge(classificationResult.audit_strength).label}
                        </span>
                        {classificationResult.justification && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                            {classificationResult.justification}
                          </p>
                        )}
                        {classificationResult.audit_tip && (
                          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 flex gap-2">
                            <Lightbulb className="text-amber-500 shrink-0 mt-0.5" size={14} />
                            <p className="text-xs text-amber-800 dark:text-amber-300">
                              <span className="font-semibold">Audit tip: </span>
                              {classificationResult.audit_tip}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Attachments */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Attach supporting documents
                    </label>
                    <div className="space-y-2">
                      {/* Pending attachment rows */}
                      {pendingAttachments.length > 0 && (
                        <ul className="space-y-2">
                          {pendingAttachments.map((a, i) => (
                            <li key={i} className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <Paperclip size={12} className="shrink-0 text-slate-400" />
                                {a.file ? (
                                  <>
                                    <span className="flex-1 truncate text-xs text-slate-700 dark:text-slate-300">{a.label}</span>
                                    <span className="text-xs text-slate-400 shrink-0">
                                      {a.file.size < 1024 * 1024
                                        ? `${(a.file.size / 1024).toFixed(0)} KB`
                                        : `${(a.file.size / (1024 * 1024)).toFixed(1)} MB`}
                                    </span>
                                    {a.status === 'uploading' && <Loader2 size={12} className="animate-spin text-primary-500 shrink-0" />}
                                    {a.status === 'uploaded' && <CheckCircle2 size={12} className="text-green-500 shrink-0" />}
                                  </>
                                ) : (
                                  <input
                                    type="text"
                                    placeholder="Label (e.g. Receipt, Photo)"
                                    value={a.label}
                                    onChange={(e) => updateAttachment(ATTACH_KEY, i, { label: e.target.value })}
                                    className="flex-1 text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:border-primary-400"
                                  />
                                )}
                                <button type="button" onClick={() => removeAttachment(ATTACH_KEY, i)} className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
                                  <X size={14} />
                                </button>
                              </div>
                              {/* Link-only: URL field */}
                              {!a.file && (
                                <input
                                  type="url"
                                  placeholder="Paste link (Dropbox, iCloud, OneDrive…)"
                                  value={a.manualUrl}
                                  onChange={(e) => {
                                    const url = e.target.value;
                                    const patch: Record<string, string> = { manualUrl: url };
                                    if (!a.label || a.label === labelFromUrl(a.manualUrl)) patch.label = labelFromUrl(url);
                                    updateAttachment(ATTACH_KEY, i, patch);
                                  }}
                                  className="w-full text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:border-primary-400"
                                />
                              )}
                              {a.status === 'uploaded' && (
                                <p className="text-xs text-green-600 dark:text-green-400">Uploaded</p>
                              )}
                              {a.errorMsg && <p className="text-xs text-red-500">{a.errorMsg}</p>}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Add buttons */}
                      <div className="flex gap-2">
                        <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer justify-center text-sm">
                          <Paperclip size={14} />
                          Attach file
                          <input type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) handleAddFiles(Array.from(e.target.files)); }} />
                        </label>
                      </div>
                    </div>
                  </div>

                  {errors.filter((e) => e.field !== 'description' && e.field !== 'category').length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-1">
                      {errors
                        .filter((e) => e.field !== 'description' && e.field !== 'category')
                        .map((e, i) => (
                          <p key={i} className="text-sm text-red-700 dark:text-red-300">{e.message}</p>
                        ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <Button onClick={() => handleSubmit('done')} fullWidth disabled={!categoryInput.trim() || isSubmitting || isCreatingCategory}>
                      {isSubmitting && saveMode === 'done' ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 size={16} className="animate-spin" />
                          Saving…
                        </span>
                      ) : (
                        'Save'
                      )}
                    </Button>
                    <Button variant="secondary" onClick={() => handleSubmit('another')} fullWidth disabled={!categoryInput.trim() || isSubmitting || isCreatingCategory}>
                      {isSubmitting && saveMode === 'another' ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 size={16} className="animate-spin" />
                          Saving…
                        </span>
                      ) : (
                        'Save & Add'
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
