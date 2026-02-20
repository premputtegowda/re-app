'use client';

import { Input } from '@/components/UI/Input';
import { Select } from '@/components/UI/Select';
import type { CoCAcquisition } from '@/types';

interface StepPropertyProps {
  data: Pick<CoCAcquisition, 'propertyAddress' | 'propertyType' | 'units'>;
  onChange: (field: keyof CoCAcquisition, value: string | number) => void;
}

export function StepProperty({ data, onChange }: StepPropertyProps) {
  return (
    <div className="space-y-4">
      <Input
        label="Property Address"
        type="text"
        fullWidth
        placeholder="e.g. 123 Main St, Austin TX 78701"
        value={data.propertyAddress}
        onChange={(e) => onChange('propertyAddress', e.target.value)}
      />
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Property Type"
          fullWidth
          value={data.propertyType}
          onChange={(e) => onChange('propertyType', e.target.value)}
          options={[
            { value: 'sfr', label: 'Single Family (SFR)' },
            { value: 'mfr', label: 'Multi-Family (MFR)' },
          ]}
        />
        {data.propertyType === 'mfr' && (
          <Input
            label="Number of Units"
            type="number"
            fullWidth
            min={2}
            value={data.units}
            onChange={(e) => onChange('units', Number(e.target.value))}
          />
        )}
      </div>
    </div>
  );
}
