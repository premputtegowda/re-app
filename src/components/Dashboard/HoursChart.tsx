import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card } from '../UI/Card';
import type { CategorySummary, PropertySummary, MonthlyData } from '../../types';
import { formatMonthYear } from '../../utils/dateUtils';

interface CategoryChartProps {
  data: CategorySummary[];
}

export function CategoryChart({ data }: CategoryChartProps) {
  const chartData = data.slice(0, 5).map((item) => ({
    name: item.categoryName,
    hours: item.totalHours,
    color: item.color,
  }));

  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Hours by Category</h3>
      {chartData.length === 0 ? (
        <p className="text-center text-slate-500 py-8">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="hours" radius={[8, 8, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

interface PropertyChartProps {
  data: PropertySummary[];
}

export function PropertyChart({ data }: PropertyChartProps) {
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6'];

  const chartData = data.map((item, index) => ({
    name: item.propertyName,
    value: item.totalHours,
    color: COLORS[index % COLORS.length],
  }));

  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Hours by Property</h3>
      {chartData.length === 0 ? (
        <p className="text-center text-slate-500 py-8">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

interface MonthlyTrendChartProps {
  data: MonthlyData[];
}

export function MonthlyTrendChart({ data }: MonthlyTrendChartProps) {
  const chartData = data.map((item) => ({
    month: formatMonthYear(item.month),
    hours: item.totalHours,
  }));

  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Monthly Hours Trend</h3>
      {chartData.length === 0 ? (
        <p className="text-center text-slate-500 py-8">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="hours"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={{ fill: '#3B82F6', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

interface TypeComparisonChartProps {
  materialHours: number;
  nonMaterialHours: number;
}

export function TypeComparisonChart({ materialHours, nonMaterialHours }: TypeComparisonChartProps) {
  const data = [
    { name: 'Material', value: materialHours, color: '#10B981' },
    { name: 'Non-Material', value: nonMaterialHours, color: '#F59E0B' },
  ];

  const total = materialHours + nonMaterialHours;

  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Material vs Non-Material Hours</h3>
      {total === 0 ? (
        <p className="text-center text-slate-500 py-8">No data available</p>
      ) : (
        <div className="space-y-4">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
                label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-secondary-500" />
                <span className="text-sm font-medium text-slate-700">Material</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{materialHours}h</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-accent-500" />
                <span className="text-sm font-medium text-slate-700">Non-Material</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{nonMaterialHours}h</p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
