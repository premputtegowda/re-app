'use client';

import { PDFDownloadLink } from '@react-pdf/renderer';
import { Download } from 'lucide-react';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData } from '@/types';
import { DealPDF } from './DealPDF';

interface DownloadPDFButtonProps {
  dealName: string;
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  result: CoCResult;
}

function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'deal';
}

export default function DownloadPDFButton(props: DownloadPDFButtonProps) {
  const filename = `${sanitizeFilename(props.dealName)}_underwriting.pdf`;
  return (
    <PDFDownloadLink
      document={
        <DealPDF
          dealName={props.dealName}
          acquisition={props.acquisition}
          operations={props.operations}
          proForma={props.proForma}
          refinance={props.refinance}
          result={props.result}
        />
      }
      fileName={filename}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
    >
      {({ loading }) => (
        <>
          <Download size={12} />
          {loading ? 'Preparing PDF…' : 'Download PDF'}
        </>
      )}
    </PDFDownloadLink>
  );
}
