'use client';

import { motion } from 'framer-motion';
import { CategoryManager } from './CategoryManager';
import { PropertyManager } from './PropertyManager';
import { AuditExport } from './AuditExport';

export function Settings() {
  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Settings</h2>
        <p className="text-slate-600 dark:text-slate-400">Manage your categories and properties</p>
      </motion.div>

      <motion.div
        id="categories"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <CategoryManager />
      </motion.div>

      <motion.div
        id="properties"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="border-t border-slate-200 dark:border-slate-700 pt-8"
      >
        <PropertyManager />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="border-t border-slate-200 dark:border-slate-700 pt-8"
      >
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Export & Reports</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Download your data for tax filing or audits</p>
        <AuditExport />
      </motion.div>
    </div>
  );
}
