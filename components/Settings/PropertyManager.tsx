'use client';

import { useState } from 'react';
import { Plus, Edit2, Trash2, Home } from 'lucide-react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/UI/Button';
import { Input } from '@/components/UI/Input';
import { Modal } from '@/components/UI/Modal';
import { Card } from '@/components/UI/Card';
import { validateProperty, getFieldError } from '@/utils/validationUtils';
import type { Property, PropertyFormData } from '@/types';

export function PropertyManager() {
  const properties = useStore((s) => s.properties);
  const entries = useStore((s) => s.entries);
  const addProperty = useStore((s) => s.addProperty);
  const updateProperty = useStore((s) => s.updateProperty);
  const deleteProperty = useStore((s) => s.deleteProperty);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [errors, setErrors] = useState<any[]>([]);

  const [formData, setFormData] = useState<PropertyFormData>({
    name: '',
    address: '',
  });

  const handleOpenAdd = () => {
    setFormData({ name: '', address: '' });
    setErrors([]);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (property: Property) => {
    setFormData({ name: property.name, address: property.address || '' });
    setErrors([]);
    setEditingProperty(property);
  };

  const handleAdd = () => {
    const validation = validateProperty(formData, properties);

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    addProperty(formData);
    setIsAddModalOpen(false);
    setFormData({ name: '', address: '' });
    setErrors([]);
  };

  const handleUpdate = () => {
    if (!editingProperty) return;

    const validation = validateProperty(formData, properties, editingProperty.id);

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    updateProperty({
      ...editingProperty,
      name: formData.name,
      address: formData.address,
    });
    setEditingProperty(null);
    setFormData({ name: '', address: '' });
    setErrors([]);
  };

  const handleDelete = (propertyId: string) => {
    deleteProperty(propertyId);
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Home className="text-primary-600 dark:text-primary-400" size={24} />
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Properties</h3>
        </div>
        <Button onClick={handleOpenAdd} size="sm" className="flex items-center gap-2">
          <Plus size={18} />
          Add Property
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {properties.map((property) => {
          const isInUse = entries.some((e) => e.property === property.id);

          return (
            <Card key={property.id} padding="sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white">{property.name}</p>
                  {property.address && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{property.address}</p>
                  )}
                  {isInUse && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Used in {entries.filter((e) => e.property === property.id).length} entries
                    </p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleOpenEdit(property)}
                    className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => isInUse ? setDeleteBlocked(property.id) : setDeleteConfirm(property.id)}
                    className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {properties.length === 0 && (
        <Card>
          <div className="text-center py-8">
            <Home className="mx-auto text-slate-300 dark:text-slate-600 mb-4" size={48} />
            <p className="text-slate-600 dark:text-slate-400">No properties yet. Add your first property to get started.</p>
          </div>
        </Card>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isAddModalOpen || editingProperty !== null}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingProperty(null);
          setErrors([]);
        }}
        title={editingProperty ? 'Edit Property' : 'Add Property'}
      >
        <div className="space-y-4">
          <Input
            label="Property Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            error={getFieldError(errors, 'name')}
            placeholder="e.g., 123 Main Street Property"
            fullWidth
          />

          <Input
            label="Address (Optional)"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            error={getFieldError(errors, 'address')}
            placeholder="e.g., 123 Main St, City, State 12345"
            fullWidth
          />

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setIsAddModalOpen(false);
                setEditingProperty(null);
                setErrors([]);
              }}
              fullWidth
            >
              Cancel
            </Button>
            <Button onClick={editingProperty ? handleUpdate : handleAdd} fullWidth>
              {editingProperty ? 'Update' : 'Add'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Blocked Delete Modal */}
      <Modal
        isOpen={deleteBlocked !== null}
        onClose={() => setDeleteBlocked(null)}
        title="Cannot Delete Property"
      >
        <div className="space-y-4">
          {(() => {
            const count = entries.filter((e) => e.property === deleteBlocked).length;
            return (
              <p className="text-slate-600 dark:text-slate-400">
                This property has <span className="font-semibold text-slate-900 dark:text-white">{count} {count === 1 ? 'entry' : 'entries'}</span> associated with it. Please delete those entries first before removing this property.
              </p>
            );
          })()}
          <Button onClick={() => setDeleteBlocked(null)} fullWidth>OK</Button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Property"
      >
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-400">
            Are you sure you want to delete this property? This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)} fullWidth>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              fullWidth
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
