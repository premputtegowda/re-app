import { CategoryManager } from './CategoryManager';
import { PropertyManager } from './PropertyManager';

export function Settings() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Settings</h2>
        <p className="text-slate-600">Manage your categories and properties</p>
      </div>

      <CategoryManager />

      <div className="border-t border-slate-200 pt-8">
        <PropertyManager />
      </div>
    </div>
  );
}
