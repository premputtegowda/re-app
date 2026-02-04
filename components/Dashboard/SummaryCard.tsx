'use client';

import { LucideIcon } from 'lucide-react';
import { Card } from '@/components/UI/Card';

interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

export function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-primary-600',
  trend,
}: SummaryCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">{title}</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{value}</p>
          {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          {trend && (
            <div className="mt-2">
              <span
                className={`text-sm font-medium ${
                  trend.isPositive ? 'text-secondary-600' : 'text-red-600'
                }`}
              >
                {trend.isPositive ? '↑' : '↓'} {trend.value}
              </span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-lg bg-slate-50 dark:bg-slate-700 ${iconColor}`}>
          <Icon size={24} />
        </div>
      </div>
    </Card>
  );
}
