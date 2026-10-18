import {
  Award,
  CalendarDays,
  FileCheck,
  Layout,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import Modal from './Modal';

export interface CertificatePreviewData {
  recipientName: string;
  recipientEmail: string;
  courseName: string;
  issuerName: string;
  grade: string;
  issueDate: string;
  expiryDate?: string;
  templateName?: string;
}

interface CertificatePreviewModalProps {
  isOpen: boolean;
  preview: CertificatePreviewData;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const formatDate = (value: string) => {
  if (!value) {
    return 'Not specified';
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const CertificatePreviewModal = ({
  isOpen,
  preview,
  isSubmitting,
  onClose,
  onConfirm,
}: CertificatePreviewModalProps) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="certificate-preview-title"
      wrapperClassName="fixed inset-0 z-50 flex items-center justify-center p-4"
      overlayClassName="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      dialogClassName="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full border border-slate-200 bg-white/90 p-2 text-slate-500 transition hover:text-slate-900"
        aria-label="Close preview"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="grid max-h-[90vh] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-y-auto bg-gradient-to-br from-amber-50 via-white to-blue-50 p-6 sm:p-8 lg:p-10">
          <div className="rounded-[28px] border border-amber-200/60 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] sm:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                {preview.issuerName}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] tracking-[0.2em] text-slate-600">
                Draft Preview
              </span>
            </div>

            <div className="mt-12 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.45em] text-amber-700">
                Certificate of Achievement
              </p>
              <h2 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                {preview.recipientName}
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                has successfully completed <span className="font-semibold text-slate-900">{preview.courseName}</span>
                {' '}with a grade of <span className="font-semibold text-slate-900">{preview.grade}</span>.
              </p>
            </div>

            <div className="mt-12 grid gap-4 border-t border-dashed border-slate-200 pt-8 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Issued On</p>
                <p className="mt-2 text-sm font-medium text-slate-700">{formatDate(preview.issueDate)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Valid Until</p>
                <p className="mt-2 text-sm font-medium text-slate-700">{preview.expiryDate ? formatDate(preview.expiryDate) : 'No expiry date'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Template</p>
                <p className="mt-2 text-sm font-medium text-slate-700">{preview.templateName || 'Default template'}</p>
              </div>
            </div>

            <div className="mt-10 flex items-end justify-between gap-6 border-t border-slate-100 pt-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Issued By</p>
                <p className="mt-3 text-lg font-semibold text-slate-900">{preview.issuerName}</p>
                <p className="mt-1 text-sm text-slate-500">StellarCert issuer confirmation pending</p>
              </div>
              <Award className="h-12 w-12 text-amber-500" />
            </div>
          </div>
        </div>

        <div className="overflow-y-auto bg-slate-950 px-6 py-8 text-slate-50 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3 text-sm font-medium text-amber-300">
            <Sparkles className="h-4 w-4" />
            Final review before blockchain issuance
          </div>
          <h3 id="certificate-preview-title" className="mt-4 text-2xl font-semibold text-white">Confirm certificate details</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Review the draft exactly as the recipient will see it. Once confirmed, the certificate request is submitted for permanent recording.
          </p>

          <div className="mt-8 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Recipient</p>
              <div className="mt-3 space-y-3 text-sm text-slate-100">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-amber-300" />
                  <span>{preview.recipientName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-amber-300" />
                  <span>{preview.recipientEmail}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Credential</p>
              <div className="mt-3 space-y-3 text-sm text-slate-100">
                <div className="flex items-center gap-3">
                  <FileCheck className="h-4 w-4 text-amber-300" />
                  <span>{preview.courseName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Award className="h-4 w-4 text-amber-300" />
                  <span>{preview.grade}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Layout className="h-4 w-4 text-amber-300" />
                  <span>{preview.templateName || 'Default template'}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Dates</p>
              <div className="mt-3 space-y-3 text-sm text-slate-100">
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 text-amber-300" />
                  <span>Issue date: {formatDate(preview.issueDate)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 text-amber-300" />
                  <span>Expiry date: {preview.expiryDate ? formatDate(preview.expiryDate) : 'No expiry date'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
            Verify names, course text, grade, and dates now. These are the most common sources of irreversible issuance mistakes.
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Back to edit
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Issuing certificate...' : 'Confirm and issue'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CertificatePreviewModal;