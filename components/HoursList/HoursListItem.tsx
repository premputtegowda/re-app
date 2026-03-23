'use client';

import { useState, useMemo } from 'react';
import {
  Edit2, Trash2, Calendar, Clock, Home, FileText, Loader2, Paperclip,
  AlertCircle, X, Brain, ShieldCheck, Sparkles, RotateCcw, Lightbulb, Pencil,
  Upload, CheckCircle2, ExternalLink, Download,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { useAttachmentStore } from '@/lib/attachmentStore';
import { api } from '@/lib/api';
import { Button } from '@/components/UI/Button';
import { Card } from '@/components/UI/Card';
import { Modal } from '@/components/UI/Modal';
import type { HoursEntry, ClassificationResult } from '@/types';
import { formatDate } from '@/utils/dateUtils';
import { formatDuration } from '@/utils/calculations';
import { getCachedClassification, setCachedClassification } from '@/utils/classificationCache';
import { labelFromUrl, dropboxDownloadUrl } from '@/utils/attachmentUtils';
import { uploadFileToR2 } from '@/lib/r2Api';

const QUICK_HOURS = [1, 2, 3, 4, 6, 8];
const QUICK_MINUTES = [15, 30, 45];
const EMPTY_ATTACHMENTS: import('@/lib/attachmentStore').PendingAttachment[] = [];
const CATEGORY_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'];

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

const auditStrengthBadge = (strength: string) => {
  if (strength === 'high')   return { label: 'High Audit Strength',   classes: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' };
  if (strength === 'medium') return { label: 'Medium Audit Strength', classes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' };
  return                            { label: 'Low Audit Strength',    classes: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' };
};

interface HoursListItemProps {
  entry: HoursEntry;
}

export function HoursListItem({ entry }: HoursListItemProps) {
  const categories = useStore((s) => s.categories);
  const properties = useStore((s) => s.properties);
  const updateEntry = useStore((s) => s.updateEntry);
  const patchEntryAttachments = useStore((s) => s.patchEntryAttachments);
  const deleteEntry = useStore((s) => s.deleteEntry);
  const addCategory = useStore((s) => s.addCategory);
  const ATTACH_KEY = `edit-${entry.id}`;
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
        const result = await uploadFileToR2(files[i], entry.id);
        updateAttachment(ATTACH_KEY, idx, { status: 'uploaded', r2Key: result.key, fileUrl: '', errorMsg: '' });
      } catch (e) {
        updateAttachment(ATTACH_KEY, idx, { status: 'error', errorMsg: e instanceof Error ? e.message : 'Upload failed' });
      }
    }
  };

  // ── Modal visibility ──
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // ── Edit form data (property, date, time, raw description) ──
  const [editData, setEditData] = useState({
    date: entry.date,
    hours: entry.hours,
    minutes: entry.minutes,
    property: entry.property,
    description: entry.description,
  });

  // ── Category & type (managed separately to support AI override flow) ──
  const [selectedCategoryId, setSelectedCategoryId] = useState(entry.category);
  const [categoryInput, setCategoryInput] = useState('');
  const [selectedType, setSelectedType] = useState<'material' | 'non-material'>(entry.type);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  // ── Inline summary bar editing ──
  const [editingSection, setEditingSection] = useState<'property' | 'datetime' | null>(null);

  // ── AI classification ──
  const [classificationResult, setClassificationResult] = useState<ClassificationResult | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);

  // ── Stored AI recommendations (from DB, never change after first classify) ──
  const [aiCategoryId, setAiCategoryId] = useState<string>('');
  const [aiType, setAiType] = useState<'material' | 'non-material' | ''>('');

  // ── Last user-selected category before reverting to AI ──
  const [lastUsedCategoryId, setLastUsedCategoryId] = useState<string>('');

  // ── Description: raw (editable) + AI refined (read-only toggle) ──
  const [useRefinedDescription, setUseRefinedDescription] = useState(false);
  const [refinedDescription, setRefinedDescription] = useState('');
  const [originalAiDescription, setOriginalAiDescription] = useState('');

  // ── Reclassify on blur / Done ──
  const [isDescriptionDirty, setIsDescriptionDirty] = useState(false);
  const [isTextareaFocused, setIsTextareaFocused] = useState(false);
  const [lastClassifiedDesc, setLastClassifiedDesc] = useState('');

  const handleDescriptionClassify = async () => {
    if (isClassifying) return;
    setIsDescriptionDirty(false);
    const desc = editData.description.trim();
    if (!desc || desc === lastClassifiedDesc) return;
    setLastClassifiedDesc(desc);
    const cached = getCachedClassification(desc);
    if (cached) { applyClassificationResult(cached); setUseRefinedDescription(true); return; }
    setIsClassifying(true);
    setClassificationError(null);
    try {
      const result: ClassificationResult = await api.classifyActivity(desc);
      setCachedClassification(desc, result);
      applyClassificationResult(result);
      setUseRefinedDescription(true);
    } catch (err: any) {
      setClassificationError(err.message || 'Classification failed.');
    } finally {
      setIsClassifying(false);
    }
  };

  const handleDescriptionBlur = () => {
    setIsTextareaFocused(false);
    if (isDescriptionDirty) handleDescriptionClassify();
  };

  // ── Attachments ──
  const [deletingAttachmentIds, setDeletingAttachmentIds] = useState<Set<string>>(new Set());

  const handleDeleteSavedAttachment = async (attachmentId: string) => {
    if (!window.confirm('Delete this attachment? This cannot be undone.')) return;
    setDeletingAttachmentIds((prev) => new Set(prev).add(attachmentId));
    try {
      await api.deleteAttachment(entry.id, attachmentId);
      // Update store immediately so card view and modal stay in sync
      patchEntryAttachments(entry.id, (entry.attachments ?? []).filter((a) => a.id !== attachmentId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete attachment';
      setErrors([{ field: 'general', message: msg }]);
    } finally {
      setDeletingAttachmentIds((prev) => {
        const next = new Set(prev);
        next.delete(attachmentId);
        return next;
      });
    }
  };

  // ── Misc ──
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);

  // ── Derived ──
  const isAiDescriptionModified = !!originalAiDescription && refinedDescription !== originalAiDescription;

  // AI category name: from fresh classification OR from stored aiCategoryId
  const aiCategoryName = classificationResult
    ? (classificationResult.category_name ?? classificationResult.suggested_new_category ?? '')
    : (aiCategoryId ? (categories.find((c) => c.id === aiCategoryId)?.name ?? '') : '');

  const allCategoryOptions = useMemo(() => {
    const aiName = classificationResult
      ? (classificationResult.category_name ?? classificationResult.suggested_new_category ?? '')
      : (aiCategoryId ? (categories.find((c) => c.id === aiCategoryId)?.name ?? '') : '');
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
  }, [categories, classificationResult, aiCategoryId]);

  // Overridden = user picked something different from AI recommendation
  const isCategoryOverridden = classificationResult
    ? (!!aiCategoryName && categoryInput.trim().toLowerCase() !== aiCategoryName.toLowerCase())
    : (!!aiCategoryId && selectedCategoryId !== aiCategoryId);

  const isTypeOverridden = classificationResult
    ? selectedType !== classificationResult.type
    : (!!aiType && selectedType !== aiType);

  const selectedProperty = properties.find((p) => p.id === editData.property);
  const timeLabel =
    editData.hours > 0 && editData.minutes > 0
      ? `${editData.hours}h ${editData.minutes}m`
      : editData.hours > 0
      ? `${editData.hours}h`
      : `${editData.minutes}m`;

  const getFieldError = (field: string) => errors.find((e) => e.field === field)?.message;

  // ── List row display values ──
  const displayCategory = categories.find((c) => c.id === entry.category);
  const displayProperty = properties.find((p) => p.id === entry.property);

  // ── Handlers ──

  const handleEdit = () => {
    const catName = categories.find((c) => c.id === entry.category)?.name ?? '';
    // Use stored raw_description if available, else fall back to description
    const rawDesc = entry.raw_description ?? entry.description;
    setEditData({
      date: entry.date,
      hours: entry.hours,
      minutes: entry.minutes,
      property: entry.property,
      description: rawDesc,
    });
    setSelectedCategoryId(entry.category);
    setCategoryInput(catName);
    setSelectedType(entry.type);
    setClassificationResult(null);
    setClassificationError(null);
    // Restore stored AI refined if available
    const storedRefined = entry.refined_description ?? '';
    setRefinedDescription(storedRefined);
    setOriginalAiDescription(storedRefined);
    setUseRefinedDescription(!!storedRefined && entry.description === storedRefined);
    setAiCategoryId(entry.ai_category_id ?? '');
    setAiType((entry.ai_type as 'material' | 'non-material') ?? '');
    setLastUsedCategoryId('');
    setIsDescriptionDirty(false);
    setIsTextareaFocused(false);
    setLastClassifiedDesc(rawDesc.trim());
    setIsClassifying(false);
    setEditingSection(null);
    setIsCreatingCategory(false);
    setErrors([]);
    setIsEditModalOpen(true);
  };

  const applyClassificationResult = (result: ClassificationResult) => {
    setClassificationResult(result);
    const aiText = result.refined_description || '';
    setRefinedDescription(aiText);
    setOriginalAiDescription(aiText);
    setUseRefinedDescription(!!aiText);
    setSelectedType(result.type);
    const name = result.category_name ?? result.suggested_new_category ?? '';
    setCategoryInput(name);
    const match = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    setSelectedCategoryId(match?.id ?? '');
  };

  const runClassification = async () => {
    const desc = editData.description.trim();
    if (!desc) return;
    const cached = getCachedClassification(desc);
    if (cached) {
      applyClassificationResult(cached);
      return;
    }
    setIsClassifying(true);
    setClassificationError(null);
    try {
      const result: ClassificationResult = await api.classifyActivity(desc);
      setCachedClassification(desc, result);
      applyClassificationResult(result);
    } catch (err: any) {
      setClassificationError(err.message || 'Classification failed. Please select manually.');
    } finally {
      setIsClassifying(false);
    }
  };

  const handleCategorySelect = async (option: { id: string; name: string; isNew: boolean }) => {
    if (option.isNew) {
      const color = CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length];
      setIsCreatingCategory(true);
      try {
        await addCategory({ name: option.name, color });
        const created = useStore
          .getState()
          .categories.find((c) => c.name.toLowerCase() === option.name.toLowerCase());
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
    // Save current selection as "last used" before reverting to AI
    if (selectedCategoryId) setLastUsedCategoryId(selectedCategoryId);

    if (classificationResult) {
      // Fresh classification: find or create the AI-suggested category
      const targetName = classificationResult.category_name ?? classificationResult.suggested_new_category;
      if (!targetName) return;
      const existing = categories.find((c) => c.name.toLowerCase() === targetName.toLowerCase());
      if (existing) {
        setSelectedCategoryId(existing.id);
        setCategoryInput(existing.name);
      } else {
        const color = CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length];
        setIsCreatingCategory(true);
        try {
          await addCategory({ name: targetName, color });
          const created = useStore
            .getState()
            .categories.find((c) => c.name.toLowerCase() === targetName.toLowerCase());
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
    } else if (aiCategoryId) {
      // Stored AI category: look up by ID directly
      const cat = categories.find((c) => c.id === aiCategoryId);
      if (cat) {
        setSelectedCategoryId(cat.id);
        setCategoryInput(cat.name);
      }
    }
  };

  const handleRevertType = () => {
    if (classificationResult) {
      setSelectedType(classificationResult.type);
    } else if (aiType) {
      setSelectedType(aiType);
    }
  };

  const handleSaveEdit = async () => {
    const activeDescription =
      useRefinedDescription && refinedDescription ? refinedDescription : editData.description;

    if (!activeDescription.trim()) {
      setErrors([{ field: 'description', message: 'Description is required' }]);
      return;
    }
    if (editData.hours === 0 && editData.minutes === 0) {
      setErrors([{ field: 'hours', message: 'Time must be greater than 0' }]);
      return;
    }
    if (!selectedCategoryId) {
      setErrors([{ field: 'category', message: 'Please select a category' }]);
      return;
    }
    if (!editData.property) {
      setErrors([{ field: 'property', message: 'Please select a property' }]);
      return;
    }
    setErrors([]);
    setIsSaving(true);
    try {
      await updateEntry({
        ...entry,
        date: editData.date,
        hours: editData.hours,
        minutes: editData.minutes,
        category: selectedCategoryId,
        property: editData.property,
        description: activeDescription,
        raw_description: editData.description,
        refined_description: originalAiDescription || undefined,
        // Store AI picks: use newly classified values if available, else preserve existing
        ai_category_id: classificationResult
          ? (categories.find((c) => c.name.toLowerCase() === (classificationResult.category_name ?? '').toLowerCase())?.id ?? aiCategoryId ?? undefined)
          : (aiCategoryId || undefined),
        ai_type: (classificationResult?.type ?? aiType) || undefined,
        type: selectedType,
      });

      // Save any new attachments uploaded to R2 or with manual URLs
      const attachsToSave = pendingAttachments.filter(
        (a) => a.r2Key.trim() || a.manualUrl.trim()
      );
      if (attachsToSave.length > 0) {
        const results = await Promise.allSettled(
          attachsToSave.map((a) =>
            api.createAttachment(entry.id, {
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
          patchEntryAttachments(entry.id, [...(entry.attachments ?? []), ...saved]);
        }
      }
      clearAttachKey(ATTACH_KEY);
      setIsEditModalOpen(false);
    } catch {
      setErrors([{ field: 'general', message: 'Failed to save changes' }]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    deleteEntry(entry.id);
    setIsDeleteModalOpen(false);
  };

  return (
    <>
      {/* ── List row ── */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <Calendar size={14} />
                <span className="text-sm font-medium">{formatDate(entry.date)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-primary-600 dark:text-primary-400">
                <Clock size={14} />
                <span className="text-sm font-semibold">{formatDuration(entry.totalMinutes)}</span>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                entry.type === 'material'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
              }`}>
                {entry.type === 'material' ? 'Material' : 'Non-Material'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {displayCategory && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: displayCategory.color }} />
                  <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{displayCategory.name}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 min-w-0">
                <Home size={14} className="shrink-0" />
                <span className="text-sm truncate">{displayProperty?.name}</span>
              </div>
            </div>
            {entry.description && (
              <div className="flex items-start gap-1.5">
                <FileText size={14} className="text-slate-400 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words min-w-0">{entry.description}</p>
              </div>
            )}
            {(entry.attachments ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(entry.attachments ?? []).map((a) => {
                  const isR2 = a.file_ref && a.file_ref.includes('/');
                  const openFile = async () => {
                    if (isR2) {
                      const url = await api.getDownloadUrl(a.file_ref);
                      window.open(url, '_blank');
                    } else if (a.attachment_url) {
                      window.open(a.attachment_url, '_blank');
                    }
                  };
                  const downloadFile = async () => {
                    let url: string;
                    if (isR2) {
                      url = await api.getDownloadUrl(a.file_ref);
                    } else if (a.attachment_url) {
                      url = dropboxDownloadUrl(a.attachment_url) ?? a.attachment_url;
                    } else return;
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = a.original_filename || 'attachment';
                    link.click();
                  };
                  return (
                    <span key={a.id} className="inline-flex items-center gap-0.5">
                      <button
                        onClick={openFile}
                        title="View file"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-l-full pl-2 pr-1.5 py-0.5 transition-colors max-w-[140px]"
                      >
                        <Paperclip size={10} className="shrink-0" />
                        <span className="truncate">{a.original_filename}</span>
                        <ExternalLink size={9} className="shrink-0 opacity-60" />
                      </button>
                      <button
                        onClick={downloadFile}
                        title="Download file"
                        className="inline-flex items-center px-1.5 py-0.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-r-full border-l border-blue-200 dark:border-blue-800 transition-colors"
                      >
                        <Download size={9} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={handleEdit} className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Edit">
              <Edit2 size={16} />
            </button>
            <button onClick={() => setIsDeleteModalOpen(true)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Delete">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Edit Modal ── */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => { if (!isClassifying) { setIsEditModalOpen(false); setErrors([]); } }}
        title="Edit Entry"
        size="lg"
      >
        <div className="space-y-3">

          {/* Property summary bar / inline editor */}
          {editingSection === 'property' ? (
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <Home className="text-primary-600 dark:text-primary-400" size={20} />
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Which property?</h3>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {properties.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setEditData((d) => ({ ...d, property: p.id }));
                        setEditingSection(null);
                      }}
                      className={`text-left p-4 border-2 rounded-lg transition-all ${
                        editData.property === p.id
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-slate-200 dark:border-slate-600 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                      }`}
                    >
                      <p className="font-medium text-slate-900 dark:text-white">{p.name}</p>
                      {p.address && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{p.address}</p>}
                    </button>
                  ))}
                </div>
                <Button variant="secondary" onClick={() => setEditingSection(null)} fullWidth>Cancel</Button>
              </div>
            </Card>
          ) : (
            <SummaryBar
              icon={<Home size={18} />}
              label="Property"
              value={selectedProperty?.name ?? '—'}
              onEdit={() => { if (!isClassifying) setEditingSection('property'); }}
            />
          )}

          {/* Date/Time summary bar / inline editor */}
          {editingSection === 'datetime' ? (
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <Clock className="text-primary-600 dark:text-primary-400" size={20} />
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">How long?</h3>
                </div>

                {/* Quick hours */}
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Quick select (hours):</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_HOURS.map((h) => (
                      <button
                        key={h}
                        onClick={() => setEditData((d) => d.hours === h && d.minutes === 0 ? { ...d, hours: 0 } : { ...d, hours: h, minutes: 0 })}
                        className={`px-4 py-2 rounded-lg border-2 transition-all ${
                          editData.hours === h && editData.minutes === 0
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                            : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {h}h
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick minutes */}
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Quick select (minutes):</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_MINUTES.map((m) => (
                      <button
                        key={m}
                        onClick={() => setEditData((d) => d.hours === 0 && d.minutes === m ? { ...d, minutes: 0 } : { ...d, hours: 0, minutes: m })}
                        className={`px-4 py-2 rounded-lg border-2 transition-all ${
                          editData.hours === 0 && editData.minutes === m
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                            : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom time */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">Or enter custom time:</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Hours</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        value={editData.hours}
                        onChange={(e) => setEditData((d) => ({ ...d, hours: parseInt(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Minutes</label>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={editData.minutes}
                        onChange={(e) => setEditData((d) => ({ ...d, minutes: parseInt(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-center"
                      />
                    </div>
                  </div>
                </div>

                {/* Date */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <label className="block text-sm text-slate-600 dark:text-slate-400 mb-2">Date</label>
                  <input
                    type="date"
                    value={editData.date}
                    onChange={(e) => setEditData((d) => ({ ...d, date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                  />
                </div>

                {getFieldError('hours') && (
                  <p className="text-sm text-red-500">{getFieldError('hours')}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setEditingSection(null)} fullWidth>Cancel</Button>
                  <Button
                    onClick={() => {
                      if (editData.hours === 0 && editData.minutes === 0) {
                        setErrors([{ field: 'hours', message: 'Please enter at least some time' }]);
                        return;
                      }
                      setErrors([]);
                      setEditingSection(null);
                    }}
                    fullWidth
                  >
                    Done
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <SummaryBar
              icon={<Clock size={18} />}
              label="Time & Date"
              value={`${timeLabel} · ${editData.date}`}
              onEdit={() => { if (!isClassifying) setEditingSection('datetime'); }}
            />
          )}

          {/* ── Step 4 card — exact replica ── */}
          <Card>
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Brain className="text-primary-600 dark:text-primary-400" size={24} />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Review & Edit</h3>
              </div>

              {/* AI classifying banner — blocks all interactions */}
              {isClassifying && (
                <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700 rounded-lg p-3 flex items-center gap-3">
                  <Loader2 size={16} className="animate-spin text-primary-600 dark:text-primary-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-primary-700 dark:text-primary-300">AI is classifying your activity…</p>
                    <p className="text-xs text-primary-500 dark:text-primary-400 mt-0.5">Save and other actions are disabled until done.</p>
                  </div>
                </div>
              )}

              {/* Classification error */}
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

              {/* Description — always show toggle between Your original and AI refined */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Activity Description <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setUseRefinedDescription(false)}
                      disabled={isClassifying}
                      className={`px-3 py-1 transition-colors disabled:opacity-60 ${!useRefinedDescription ? 'bg-primary-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      Your original
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseRefinedDescription(true)}
                      disabled={isClassifying}
                      className={`px-3 py-1 transition-colors disabled:opacity-60 ${useRefinedDescription ? 'bg-primary-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      AI refined
                    </button>
                  </div>
                </div>

                {/* Your original — always editable */}
                {!useRefinedDescription && (
                  <>
                    <div className="relative">
                      <textarea
                        rows={4}
                        maxLength={2000}
                        value={editData.description}
                        onChange={(e) => {
                          setIsDescriptionDirty(true);
                          setEditData((d) => ({ ...d, description: e.target.value }));
                        }}
                        onFocus={() => setIsTextareaFocused(true)}
                        onBlur={handleDescriptionBlur}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none text-sm pb-8"
                      />
                      {(isTextareaFocused || isDescriptionDirty) && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={handleDescriptionClassify}
                          className="absolute bottom-2 right-2 px-2.5 py-1 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors shadow-sm"
                        >
                          Done
                        </button>
                      )}
                    </div>
                    {isClassifying && (
                      <p className="text-xs text-primary-500 dark:text-primary-400 mt-1 flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin shrink-0" />
                        Classifying… switching to AI refined when done.
                      </p>
                    )}
                    {!isClassifying && !isDescriptionDirty && refinedDescription && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">Your original will be used for audit.</p>
                    )}
                  </>
                )}

                {/* AI refined — read-only */}
                {useRefinedDescription && (
                  <>
                    {isClassifying ? (
                      <div className="w-full px-3 py-2 border border-primary-300 dark:border-primary-600 rounded-lg bg-slate-50 dark:bg-slate-800/60 h-[104px] flex items-center justify-center gap-2 text-xs text-primary-600 dark:text-primary-400">
                        <Loader2 size={13} className="animate-spin" />
                        <span>Classifying…</span>
                      </div>
                    ) : refinedDescription ? (
                      <>
                        <textarea
                          rows={4}
                          readOnly
                          value={refinedDescription}
                          className="w-full px-3 py-2 border border-primary-300 dark:border-primary-600 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 resize-none text-sm cursor-default"
                        />
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">AI refined will be used for audit.</p>
                      </>
                    ) : (
                      <div className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-800/60 h-[104px] flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                        No AI refinement yet — edit the description to trigger classification.
                      </div>
                    )}
                  </>
                )}

                {getFieldError('description') && (
                  <p className="text-xs text-red-500 mt-1">{getFieldError('description')}</p>
                )}
              </div>

              {/* AI Classification card */}
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 space-y-4">

                {/* Header row: label only */}
                <div className="flex items-center gap-2">
                  {classificationResult && !classificationError ? (
                    <>
                      <ShieldCheck className="text-primary-500 shrink-0" size={16} />
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        AI Classification
                      </p>
                    </>
                  ) : (
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Category & Type</p>
                  )}
                </div>

                {/* Refined title */}
                {classificationResult && !classificationError && classificationResult.refined_title && (
                  <p className="font-semibold text-slate-900 dark:text-white text-sm leading-snug">
                    {classificationResult.refined_title}
                  </p>
                )}

                {/* Category chips */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Category</label>
                    {isCategoryOverridden && (
                      <button
                        type="button"
                        onClick={handleRevertCategory}
                        disabled={isCreatingCategory || isClassifying}
                        className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                      >
                        <RotateCcw size={10} />
                        Revert to AI pick
                      </button>
                    )}
                    {!isCategoryOverridden && !!lastUsedCategoryId && (() => {
                      const lastCat = categories.find((c) => c.id === lastUsedCategoryId);
                      if (!lastCat) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCategoryId(lastCat.id);
                            setCategoryInput(lastCat.name);
                          }}
                          className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:underline"
                        >
                          <RotateCcw size={10} />
                          Last used: {lastCat.name}
                        </button>
                      );
                    })()}
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
                          disabled={isCreatingCategory || isClassifying}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-all border-2 disabled:opacity-60 ${
                            isSelected
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                              : option.isAiRecommended
                              ? 'border-dashed border-slate-400 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-primary-400 dark:hover:border-primary-500'
                              : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-primary-300 dark:hover:border-primary-500'
                          }`}
                        >
                          {/* Color dot for existing categories */}
                          {!option.isNew && (() => {
                            const cat = categories.find((c) => c.id === option.id);
                            return cat ? (
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                            ) : null;
                          })()}
                          {option.name}
                          {option.isNew && <span className="text-xs opacity-60 ml-0.5">· new</span>}
                        </button>
                      );
                    })}
                    {allCategoryOptions.length === 0 && (
                      <p className="text-xs text-slate-400 dark:text-slate-500">No categories yet — add one in Settings.</p>
                    )}
                  </div>
                  {getFieldError('category') && (
                    <p className="text-xs text-red-500 mt-1">{getFieldError('category')}</p>
                  )}
                </div>

                {/* Type chips */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Participation Type</label>
                    {isTypeOverridden && (
                      <button
                        type="button"
                        onClick={handleRevertType}
                        disabled={isClassifying}
                        className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                      >
                        <RotateCcw size={10} />
                        Revert to AI pick
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {(['material', 'non-material'] as const).map((type) => {
                      const isSelected = selectedType === type;
                      const isAiPick = classificationResult ? classificationResult.type === type : aiType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setSelectedType(type)}
                          disabled={isClassifying}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border-2 disabled:opacity-60 ${
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
                  Supporting documents
                </label>
                <div className="space-y-2">
                  {/* Existing saved attachments */}
                  {(entry.attachments ?? []).length > 0 && (
                    <ul className="space-y-1.5">
                      {(entry.attachments ?? [])
                                                .map((a) => (
                          <li key={a.id} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2">
                            <Paperclip size={12} className="shrink-0 text-slate-400" />
                            <button
                              type="button"
                              onClick={async () => {
                                const url = a.file_ref?.includes('/') ? await api.getDownloadUrl(a.file_ref) : a.attachment_url;
                                if (url) window.open(url, '_blank');
                              }}
                              title="View file"
                              className="flex-1 min-w-0 flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline text-left"
                            >
                              <span className="truncate">{a.original_filename}</span>
                              <ExternalLink size={10} className="shrink-0 opacity-60" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                let url: string | undefined;
                                if (a.file_ref?.includes('/')) {
                                  url = await api.getDownloadUrl(a.file_ref);
                                } else {
                                  url = dropboxDownloadUrl(a.attachment_url) ?? a.attachment_url;
                                }
                                if (!url) return;
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = a.original_filename || 'attachment';
                                link.click();
                              }}
                              title="Download"
                              className="text-slate-400 hover:text-primary-500 transition-colors shrink-0"
                            >
                              <Download size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSavedAttachment(a.id)}
                              disabled={deletingAttachmentIds.has(a.id)}
                              className="text-slate-400 hover:text-red-500 transition-colors shrink-0 disabled:opacity-50"
                            >
                              {deletingAttachmentIds.has(a.id)
                                ? <Loader2 size={13} className="animate-spin" />
                                : <X size={13} />}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                  {/* New pending attachments */}
                  {pendingAttachments.length > 0 && (
                    <ul className="space-y-2">
                      {pendingAttachments.map((a, i) => (
                        <li key={i} className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 space-y-2">
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
                            <button
                              type="button"
                              onClick={() => removeAttachment(ATTACH_KEY, i)}
                              className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                            >
                              <X size={13} />
                            </button>
                          </div>
                          {a.file ? (
                            <span className="flex items-center gap-1 text-xs">
                              {a.status === 'uploading' && (
                                <><Loader2 size={12} className="animate-spin text-primary-500" /><span className="text-slate-400">Uploading…</span></>
                              )}
                              {a.status === 'uploaded' && (
                                <><CheckCircle2 size={12} className="text-green-500" /><span className="text-green-600 dark:text-green-400">Uploaded</span></>
                              )}
                              {a.status === 'error' && (
                                <span className="text-red-500">{a.errorMsg}</span>
                              )}
                            </span>
                          ) : (
                            <div className="space-y-1.5">
                              <input
                                type="url"
                                placeholder="Paste a link (Dropbox, iCloud, OneDrive…)"
                                value={a.manualUrl}
                                onChange={(e) => {
                                  const url = e.target.value;
                                  const patch: Record<string, string> = { manualUrl: url };
                                  if (!a.label || a.label === labelFromUrl(a.manualUrl)) {
                                    patch.label = labelFromUrl(url);
                                  }
                                  updateAttachment(ATTACH_KEY, i, patch);
                                }}
                                className="w-full text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:border-primary-400"
                              />
                              {a.errorMsg && (
                                <p className="text-xs text-red-500">{a.errorMsg}</p>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer justify-center text-sm">
                      <Paperclip size={14} />
                      Attach file
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) handleAddFiles(Array.from(e.target.files));
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* General errors */}
              {errors.filter((e) => e.field !== 'description' && e.field !== 'category').length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-1">
                  {errors
                    .filter((e) => e.field !== 'description' && e.field !== 'category')
                    .map((e, i) => (
                      <p key={i} className="text-sm text-red-700 dark:text-red-300">{e.message}</p>
                    ))}
                </div>
              )}

              {/* Save / Cancel */}
              <div className="flex gap-3 pt-1">
                <Button variant="secondary" onClick={() => setIsEditModalOpen(false)} fullWidth disabled={isClassifying}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  fullWidth
                  disabled={isSaving || isCreatingCategory || !selectedCategoryId || isClassifying || isDescriptionDirty}
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 size={15} className="animate-spin" />
                      Saving…
                    </span>
                  ) : (
                    'Save Entry'
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </Modal>

      {/* ── Delete Confirmation ── */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Entry"
      >
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-400">
            Are you sure you want to delete this entry? This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)} fullWidth>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} fullWidth>Delete</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
