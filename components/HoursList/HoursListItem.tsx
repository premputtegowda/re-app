'use client';

import { useState, useMemo } from 'react';
import {
  Edit2, Trash2, Calendar, Clock, Home, FileText, Loader2, Paperclip,
  AlertCircle, X, Brain, ShieldCheck, Sparkles, RotateCcw, Lightbulb, Pencil,
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

const QUICK_HOURS = [1, 2, 3, 4, 6, 8];
const QUICK_MINUTES = [15, 30, 45];
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
  const deleteEntry = useStore((s) => s.deleteEntry);
  const addCategory = useStore((s) => s.addCategory);
  const entryFiles = useAttachmentStore((s) => s.files[entry.id]);
  const addAttachmentFiles = useAttachmentStore((s) => s.addFiles);
  const removeAttachmentFile = useAttachmentStore((s) => s.removeFile);

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

  // ── Description: original vs AI refined (same 3-state logic as add form) ──
  const [useRefinedDescription, setUseRefinedDescription] = useState(false);
  const [refinedDescription, setRefinedDescription] = useState('');
  const [originalAiDescription, setOriginalAiDescription] = useState('');

  // ── Misc ──
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);

  // ── Derived ──
  const isAiDescriptionModified = !!originalAiDescription && refinedDescription !== originalAiDescription;

  const aiCategoryName = classificationResult?.category_name ?? classificationResult?.suggested_new_category ?? '';

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

  const isCategoryOverridden =
    !!classificationResult &&
    !!aiCategoryName &&
    categoryInput.trim().toLowerCase() !== aiCategoryName.toLowerCase();

  const isTypeOverridden = !!classificationResult && selectedType !== classificationResult.type;

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
    setEditData({
      date: entry.date,
      hours: entry.hours,
      minutes: entry.minutes,
      property: entry.property,
      description: entry.description,
    });
    setSelectedCategoryId(entry.category);
    setCategoryInput(catName);
    setSelectedType(entry.type);
    setClassificationResult(null);
    setClassificationError(null);
    setRefinedDescription('');
    setOriginalAiDescription('');
    setUseRefinedDescription(false);
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
    if (!classificationResult) return;
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
  };

  const handleRevertType = () => {
    if (classificationResult) setSelectedType(classificationResult.type);
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
        type: selectedType,
      });
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
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: displayCategory.color }} />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{displayCategory.name}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <Home size={14} />
                <span className="text-sm">{displayProperty?.name}</span>
              </div>
            </div>
            {entry.description && (
              <div className="flex items-start gap-1.5">
                <FileText size={14} className="text-slate-400 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{entry.description}</p>
              </div>
            )}
            {(entryFiles?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-full px-2 py-0.5">
                <Paperclip size={10} />
                {entryFiles!.length} file{entryFiles!.length !== 1 ? 's' : ''}
              </span>
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
        onClose={() => { setIsEditModalOpen(false); setErrors([]); }}
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
              onEdit={() => setEditingSection('property')}
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
                        onClick={() => setEditData((d) => ({ ...d, hours: h, minutes: 0 }))}
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
                        onClick={() => setEditData((d) => ({ ...d, hours: 0, minutes: m }))}
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
              onEdit={() => setEditingSection('datetime')}
            />
          )}

          {/* ── Step 4 card — exact replica ── */}
          <Card>
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Brain className="text-primary-600 dark:text-primary-400" size={24} />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Review & Edit</h3>
              </div>

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

              {/* Description with AI revert controls */}
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                  Activity Description <span className="text-red-500">*</span>
                </label>

                {/* Mode indicator + revert buttons */}
                {refinedDescription && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                      {useRefinedDescription ? (
                        isAiDescriptionModified ? (
                          <>
                            <Pencil size={10} className="text-amber-500" />
                            <span className="text-amber-600 dark:text-amber-400">Edited</span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={10} className="text-primary-500" />
                            <span>AI refined</span>
                          </>
                        )
                      ) : (
                        <>
                          <FileText size={10} />
                          <span>Your original</span>
                        </>
                      )}
                    </span>
                    <div className="flex items-center gap-3">
                      {useRefinedDescription && isAiDescriptionModified && (
                        <button
                          type="button"
                          onClick={() => setRefinedDescription(originalAiDescription)}
                          className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        >
                          <RotateCcw size={10} />
                          Revert to AI
                        </button>
                      )}
                      {useRefinedDescription ? (
                        <button
                          type="button"
                          onClick={() => setUseRefinedDescription(false)}
                          className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                          <RotateCcw size={10} />
                          Use original
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setUseRefinedDescription(true)}
                          className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                        >
                          <Sparkles size={10} />
                          {isAiDescriptionModified ? 'Use AI (edited)' : 'Use AI refined'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <textarea
                  rows={4}
                  maxLength={2000}
                  value={useRefinedDescription && refinedDescription ? refinedDescription : editData.description}
                  onChange={(e) => {
                    if (useRefinedDescription) {
                      setRefinedDescription(e.target.value);
                    } else {
                      setEditData((d) => ({ ...d, description: e.target.value }));
                    }
                  }}
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none text-sm transition-colors ${
                    useRefinedDescription && refinedDescription
                      ? isAiDescriptionModified
                        ? 'border-amber-300 dark:border-amber-600 focus:ring-amber-400'
                        : 'border-primary-300 dark:border-primary-600'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                />
                <div className="flex items-start justify-between mt-1.5 gap-2">
                  <span>
                    {useRefinedDescription && refinedDescription && !isAiDescriptionModified && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                        You can edit the AI description above.
                      </p>
                    )}
                    {getFieldError('description') && (
                      <p className="text-xs text-red-500">{getFieldError('description')}</p>
                    )}
                  </span>
                  <p className="text-xs text-slate-400 shrink-0">
                    {(useRefinedDescription && refinedDescription ? refinedDescription : editData.description).length}/2000
                  </p>
                </div>
              </div>

              {/* AI Classification card */}
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 space-y-4">

                {/* Header row: label + classify/re-classify button */}
                <div className="flex items-center justify-between">
                  {classificationResult && !classificationError ? (
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="text-primary-500 shrink-0" size={16} />
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        AI Classification
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Category & Type</p>
                  )}
                  <button
                    type="button"
                    onClick={runClassification}
                    disabled={isClassifying || !editData.description.trim()}
                    className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                  >
                    {isClassifying
                      ? <><Loader2 size={10} className="animate-spin" /> Classifying…</>
                      : <><Sparkles size={10} /> {classificationResult ? 'Re-classify' : 'Classify with AI'}</>
                    }
                  </button>
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
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-all border-2 disabled:opacity-60 ${
                            isSelected
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                              : option.isAiRecommended
                              ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:border-indigo-400'
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
                          {option.isAiRecommended && !isSelected && !categories.find((c) => c.id === option.id) && (
                            <Sparkles size={10} />
                          )}
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
                              ? type === 'material'
                                ? 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                : 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                              : isAiPick
                              ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:border-indigo-400'
                              : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-primary-300'
                          }`}
                        >
                          {isAiPick && !isSelected && <Sparkles size={10} />}
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
                  <label className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer w-full justify-center text-sm">
                    <Paperclip size={16} />
                    Add files
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) addAttachmentFiles(entry.id, Array.from(e.target.files));
                      }}
                    />
                  </label>
                  {(entryFiles?.length ?? 0) > 0 && (
                    <ul className="space-y-1">
                      {entryFiles!.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2">
                          <Paperclip size={12} className="shrink-0 text-slate-400" />
                          <span className="flex-1 truncate text-xs">{f.name}</span>
                          <span className="text-xs text-slate-400 shrink-0">
                            {f.size < 1024 * 1024
                              ? `${(f.size / 1024).toFixed(0)} KB`
                              : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeAttachmentFile(entry.id, i)}
                            className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {classificationResult?.audit_tip && (
                    <p className="text-xs text-slate-400">
                      Follow the audit tip above — attach the recommended docs here.
                    </p>
                  )}
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
                <Button variant="secondary" onClick={() => setIsEditModalOpen(false)} fullWidth>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  fullWidth
                  disabled={isSaving || isCreatingCategory || !selectedCategoryId}
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
