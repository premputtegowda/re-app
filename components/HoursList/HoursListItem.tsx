'use client';

import { useState } from 'react';
import { Edit2, Trash2, Calendar, Clock, Tag, Home, FileText } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/UI/Button';
import { Input } from '@/components/UI/Input';
import { Modal } from '@/components/UI/Modal';
import { Select } from '@/components/UI/Select';
import type { HoursEntry } from '@/types';
import { formatDate } from '@/utils/dateUtils';
import { formatDuration } from '@/utils/calculations';
import { validateHoursEntry, getFieldError } from '@/utils/validationUtils';

interface HoursListItemProps {
  entry: HoursEntry;
}

export function HoursListItem({ entry }: HoursListItemProps) {
  const { state, updateEntry, deleteEntry } = useApp();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [errors, setErrors] = useState<any[]>([]);

  const [editData, setEditData] = useState({
    date: entry.date,
    hours: entry.hours,
    minutes: entry.minutes,
    category: entry.category,
    property: entry.property,
    description: entry.description,
    type: entry.type,
  });

  const category = state.categories.find((c) => c.id === entry.category);
  const property = state.properties.find((p) => p.id === entry.property);

  const handleEdit = () => {
    setEditData({
      date: entry.date,
      hours: entry.hours,
      minutes: entry.minutes,
      category: entry.category,
      property: entry.property,
      description: entry.description,
      type: entry.type,
    });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = () => {
    const validation = validateHoursEntry(editData);

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    updateEntry({
      ...entry,
      ...editData,
    });

    setIsEditModalOpen(false);
    setErrors([]);
  };

  const handleDelete = () => {
    deleteEntry(entry.id);
    setIsDeleteModalOpen(false);
  };

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-4">
          {/* Main content */}
          <div className="flex-1 space-y-3">
            {/* Header with date and time */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-slate-600">
                <Calendar size={16} />
                <span className="text-sm font-medium">{formatDate(entry.date)}</span>
              </div>
              <div className="flex items-center gap-2 text-primary-600">
                <Clock size={16} />
                <span className="text-sm font-semibold">{formatDuration(entry.totalMinutes)}</span>
              </div>
              <div
                className={`px-2 py-1 rounded-full text-xs font-medium ${
                  entry.type === 'material'
                    ? 'bg-secondary-100 text-secondary-700'
                    : 'bg-accent-100 text-accent-700'
                }`}
              >
                {entry.type === 'material' ? 'Material' : 'Non-Material'}
              </div>
            </div>

            {/* Category and Property */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Tag size={16} className="text-slate-400" />
                {category && (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="text-sm text-slate-700">{category.name}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Home size={16} className="text-slate-400" />
                <span className="text-sm text-slate-700">{property?.name}</span>
              </div>
            </div>

            {/* Description */}
            {entry.description && (
              <div className="flex items-start gap-2">
                <FileText size={16} className="text-slate-400 mt-0.5" />
                <p className="text-sm text-slate-600 flex-1">{entry.description}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleEdit}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Edit"
            >
              <Edit2 size={18} />
            </button>
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setErrors([]);
        }}
        title="Edit Hours Entry"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            type="date"
            label="Date"
            value={editData.date}
            onChange={(e) => setEditData({ ...editData, date: e.target.value })}
            error={getFieldError(errors, 'date')}
            fullWidth
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              type="number"
              label="Hours"
              min="0"
              value={editData.hours}
              onChange={(e) => setEditData({ ...editData, hours: parseInt(e.target.value) || 0 })}
              error={getFieldError(errors, 'hours')}
            />
            <Input
              type="number"
              label="Minutes"
              min="0"
              max="59"
              value={editData.minutes}
              onChange={(e) => setEditData({ ...editData, minutes: parseInt(e.target.value) || 0 })}
              error={getFieldError(errors, 'minutes')}
            />
          </div>

          <Select
            label="Property"
            value={editData.property}
            onChange={(e) => setEditData({ ...editData, property: e.target.value })}
            options={state.properties.map((p) => ({ value: p.id, label: p.name }))}
            error={getFieldError(errors, 'property')}
            fullWidth
          />

          <Select
            label="Category"
            value={editData.category}
            onChange={(e) => setEditData({ ...editData, category: e.target.value })}
            options={state.categories.map((c) => ({ value: c.id, label: c.name }))}
            error={getFieldError(errors, 'category')}
            fullWidth
          />

          <Select
            label="Type"
            value={editData.type}
            onChange={(e) => setEditData({ ...editData, type: e.target.value as 'material' | 'non-material' })}
            options={[
              { value: 'material', label: 'Material Participation' },
              { value: 'non-material', label: 'Non-Material' },
            ]}
            error={getFieldError(errors, 'type')}
            fullWidth
          />

          <Input
            type="text"
            label="Description *"
            value={editData.description}
            onChange={(e) => setEditData({ ...editData, description: e.target.value })}
            error={getFieldError(errors, 'description')}
            fullWidth
            required
          />

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsEditModalOpen(false)} fullWidth>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} fullWidth>
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Entry"
      >
        <div className="space-y-4">
          <p className="text-slate-600">
            Are you sure you want to delete this hours entry? This action cannot be undone.
          </p>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)} fullWidth>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} fullWidth>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
