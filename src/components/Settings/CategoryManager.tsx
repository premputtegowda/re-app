import { useState } from 'react';
import { Plus, Edit2, Trash2, Tag } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { Modal } from '../UI/Modal';
import { Card } from '../UI/Card';
import { validateCategory, getFieldError } from '../../utils/validationUtils';
import type { Category, CategoryFormData } from '../../types';

const PRESET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F97316', '#06B6D4', '#84CC16', '#EF4444',
];

export function CategoryManager() {
  const { state, addCategory, updateCategory, deleteCategory } = useApp();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [errors, setErrors] = useState<any[]>([]);

  const [formData, setFormData] = useState<CategoryFormData>({
    name: '',
    color: PRESET_COLORS[0],
  });

  const handleOpenAdd = () => {
    setFormData({ name: '', color: PRESET_COLORS[0] });
    setErrors([]);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (category: Category) => {
    setFormData({ name: category.name, color: category.color });
    setErrors([]);
    setEditingCategory(category);
  };

  const handleAdd = () => {
    const validation = validateCategory(formData, state.categories);

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    addCategory(formData);
    setIsAddModalOpen(false);
    setFormData({ name: '', color: PRESET_COLORS[0] });
    setErrors([]);
  };

  const handleUpdate = () => {
    if (!editingCategory) return;

    const validation = validateCategory(formData, state.categories, editingCategory.id);

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    updateCategory({
      ...editingCategory,
      name: formData.name,
      color: formData.color,
    });
    setEditingCategory(null);
    setFormData({ name: '', color: PRESET_COLORS[0] });
    setErrors([]);
  };

  const handleDelete = (categoryId: string) => {
    deleteCategory(categoryId);
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="text-primary-600" size={24} />
          <h3 className="text-xl font-semibold text-slate-900">Categories</h3>
        </div>
        <Button onClick={handleOpenAdd} size="sm" className="flex items-center gap-2">
          <Plus size={18} />
          Add Category
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.categories.map((category) => {
          const isInUse = state.entries.some((e) => e.category === category.id);

          return (
            <Card key={category.id} padding="sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div
                    className="w-8 h-8 rounded-lg flex-shrink-0"
                    style={{ backgroundColor: category.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{category.name}</p>
                    {isInUse && (
                      <p className="text-xs text-slate-500">
                        Used in {state.entries.filter((e) => e.category === category.id).length} entries
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleOpenEdit(category)}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(category.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                    disabled={isInUse}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {state.categories.length === 0 && (
        <Card>
          <div className="text-center py-8">
            <Tag className="mx-auto text-slate-300 mb-4" size={48} />
            <p className="text-slate-600">No categories yet. Add your first category to get started.</p>
          </div>
        </Card>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isAddModalOpen || editingCategory !== null}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingCategory(null);
          setErrors([]);
        }}
        title={editingCategory ? 'Edit Category' : 'Add Category'}
      >
        <div className="space-y-4">
          <Input
            label="Category Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            error={getFieldError(errors, 'name')}
            placeholder="e.g., Property Management"
            fullWidth
          />

          <div>
            <label className="label">Color</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-10 h-10 rounded-lg transition-all ${
                    formData.color === color ? 'ring-2 ring-primary-600 ring-offset-2' : ''
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            {getFieldError(errors, 'color') && (
              <p className="mt-1 text-sm text-red-600">{getFieldError(errors, 'color')}</p>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setIsAddModalOpen(false);
                setEditingCategory(null);
                setErrors([]);
              }}
              fullWidth
            >
              Cancel
            </Button>
            <Button onClick={editingCategory ? handleUpdate : handleAdd} fullWidth>
              {editingCategory ? 'Update' : 'Add'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Category"
      >
        <div className="space-y-4">
          <p className="text-slate-600">
            Are you sure you want to delete this category? This action cannot be undone.
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
