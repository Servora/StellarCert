import { useState, useEffect, useRef } from 'react';
import { Award, CheckCircle, Eye, Layout, XCircle } from 'lucide-react';
import { fetchDefaultTemplate, fetchUserByEmail } from '../api';
import { useCreateCertificateMutation, useTemplatesQuery } from '../api/queries';
import CertificatePreviewModal, { CertificatePreviewData } from '../components/CertificatePreviewModal';
import { useAuth } from '../context/AuthContext';

const GRADE_OPTIONS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F', 'Pass', 'Distinction', 'Merit'];

interface IssueCertificateFormData {
  recipientName: string;
  recipientEmail: string;
  courseName: string;
  issuerName: string;
  grade: string;
  issueDate: string;
  expiryDate: string;
  templateId: string;
}

const formatPreviewDate = (value: string) => {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
};

const IssueCertificate = () => {
  const { user } = useAuth();
  const initialFormData: IssueCertificateFormData = {
    recipientName: '', recipientEmail: '', courseName: '',
    issuerName: '', grade: '', issueDate: '', expiryDate: '', templateId: '',
  };
  const [error, setError] = useState('');
  const [successId, setSuccessId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [formData, setFormData] = useState<IssueCertificateFormData>(initialFormData);

  // One query for the template list and the default template; both are static
  // reference data, so the result is served from cache on later visits.
  const templatesQuery = useTemplatesQuery();
  const createCertificateMutation = useCreateCertificateMutation();
  const templates = templatesQuery.data?.templates ?? [];
  const templatesLoading = templatesQuery.isPending;
  const templatesError = templatesQuery.isError
    ? 'Failed to load templates. Please refresh the page.'
    : '';

  useEffect(() => {
    if (user) {
      const fullName = ('firstName' in user && 'lastName' in user)
        ? `${(user as { firstName: string }).firstName} ${(user as { lastName: string }).lastName}`.trim()
        : ('name' in user ? (user as { name: string }).name : '');
      setFormData(prev => ({ ...prev, issuerName: fullName }));
    }
  }, [user]);

  // Preselect the default template once it is known, without clobbering a
  // template the issuer picked in the meantime.
  const appliedDefaultTemplate = useRef(false);
  useEffect(() => {
    const defaultTemplate = templatesQuery.data?.defaultTemplate;
    if (!defaultTemplate || appliedDefaultTemplate.current) return;
    appliedDefaultTemplate.current = true;
    setFormData(prev => prev.templateId ? prev : { ...prev, templateId: defaultTemplate.id });
  }, [templatesQuery.data]);

  const selectedTemplate = templates.find(t => t.id === formData.templateId);
  const previewData: CertificatePreviewData = {
    recipientName: formData.recipientName, recipientEmail: formData.recipientEmail,
    courseName: formData.courseName, issuerName: formData.issuerName,
    grade: formData.grade, issueDate: formData.issueDate,
    expiryDate: formData.expiryDate || undefined, templateName: selectedTemplate?.name,
  };

  const validateForm = (): string | null => {
    if (!formData.recipientName.trim() || formData.recipientName.trim().length < 2)
      return 'Recipient name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.recipientEmail))
      return 'Please enter a valid email address.';
    if (!formData.courseName.trim() || formData.courseName.trim().length < 3)
      return 'Course name must be at least 3 characters.';
    if (!formData.issuerName.trim() || formData.issuerName.trim().length < 2)
      return 'Issuer name must be at least 2 characters.';
    if (!formData.grade) return 'Please select a grade.';
    if (!formData.issueDate) return 'Please select an issue date.';
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (new Date(`${formData.issueDate}T00:00:00Z`) > today) return 'Issue date cannot be in the future.';
    if (formData.expiryDate && new Date(`${formData.expiryDate}T00:00:00Z`) <= new Date(`${formData.issueDate}T00:00:00Z`))
      return 'Expiry date must be after the issue date.';
    if (!formData.templateId) return 'Please select a template.';
    return null;
  };

  const handleOpenPreview = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) { setError(validationError); return; }
    setError('');
    setIsPreviewOpen(true);
  };

  const handleConfirmIssue = async () => {
    try {
      if (!user) { setError('You must be logged in to issue a certificate.'); return; }
      setIsSubmitting(true); setError('');

      // Recipient registration is optional — look them up but don't block if not found
      const [recipient, resolvedTemplateId] = await Promise.all([
        fetchUserByEmail(formData.recipientEmail).catch(() => null),
        formData.templateId ? Promise.resolve(formData.templateId) : fetchDefaultTemplate().then(t => t?.id ?? ''),
      ]);

      if (!resolvedTemplateId) { setError('Please select a template.'); return; }

      const res = await createCertificateMutation.mutateAsync({
        title: `${formData.courseName} Certificate`,
        description: `This certificate is awarded for completing the ${formData.courseName} course`,
        courseName: formData.courseName, issuerName: formData.issuerName,
        recipientName: formData.recipientName, recipientEmail: formData.recipientEmail,
        issueDate: formData.issueDate, expiryDate: formData.expiryDate || undefined,
        issuerId: user.id, recipientId: recipient?.id || undefined,
        templateId: resolvedTemplateId,
        metadata: { grade: formData.grade, courseName: formData.courseName },
      });

      if (!res) { setError('Failed to create Certificate'); return; }
      setIsPreviewOpen(false);
      setSuccessId(res.id);
      setFormData({ ...initialFormData, issuerName: formData.issuerName, templateId: formData.templateId });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Failed to issue certificate';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Award className="w-10 h-10 text-blue-600" />
        <h1 className="text-3xl font-bold">Issue Certificate</h1>
      </div>
      {successId && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-4">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-green-800 dark:text-green-300">Certificate issued successfully!</p>
            <p className="text-sm text-green-700 dark:text-green-400 mt-1">Certificate ID: <span className="font-mono">{successId}</span></p>
            <button onClick={() => setSuccessId(null)} className="mt-2 text-sm text-green-600 dark:text-green-400 underline hover:no-underline">Dismiss</button>
          </div>
        </div>
      )}
      <div className="bg-white rounded-lg shadow-md p-6">
        <form onSubmit={handleOpenPreview} className="space-y-6">
          {/* Certificate Template - single instance with loading/error guards */}
          <div>
            <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-1">
              <div className="flex items-center gap-2"><Layout className="w-4 h-4" />Certificate Template</div>
            </label>
            {templatesLoading ? (
              <div className="w-full px-4 py-2 border rounded-md bg-gray-50 text-gray-400 text-sm">Loading templates…</div>
            ) : templatesError ? (
              <div className="flex items-center gap-2 text-red-600 text-sm mt-1">
                <XCircle className="w-4 h-4 flex-shrink-0" /><span>{templatesError}</span>
              </div>
            ) : (
              <select id="template" value={formData.templateId} onChange={e => setFormData(prev => ({ ...prev, templateId: e.target.value }))}
                className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white" required>
                <option value="" disabled>Select a template</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>

          {/* Recipient Name - added to fix missing input (#447) */}
          <div>
            <label htmlFor="recipientName" className="block text-sm font-medium text-gray-700 mb-1">Recipient Name</label>
            <input id="recipientName" type="text" value={formData.recipientName}
              onChange={e => setFormData(prev => ({ ...prev, recipientName: e.target.value }))}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500" required />
          </div>

          <div>
            <label htmlFor="recipientEmail" className="block text-sm font-medium text-gray-700 mb-1">Recipient Email</label>
            <input id="recipientEmail" type="email" value={formData.recipientEmail}
              onChange={e => setFormData(prev => ({ ...prev, recipientEmail: e.target.value }))}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500" required />
          </div>
          <div>
            <label htmlFor="issuerName" className="block text-sm font-medium text-gray-700 mb-1">Issuer Name</label>
            <input id="issuerName" type="text" value={formData.issuerName}
              onChange={e => setFormData(prev => ({ ...prev, issuerName: e.target.value }))}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500" required />
          </div>
          <div>
            <label htmlFor="courseName" className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
            <input id="courseName" type="text" value={formData.courseName}
              onChange={e => setFormData(prev => ({ ...prev, courseName: e.target.value }))}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500" required />
          </div>
          <div>
            <label htmlFor="grade" className="block text-sm font-medium text-gray-700 mb-1">Grade / Achievement Level</label>
            <select id="grade" value={formData.grade} onChange={e => setFormData(prev => ({ ...prev, grade: e.target.value }))}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white" required>
              <option value="" disabled>Select a grade</option>
              {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="issueDate" className="block text-sm font-medium text-gray-700 mb-1">Issue Date</label>
            <input id="issueDate" type="date" value={formData.issueDate}
              onChange={e => setFormData(prev => ({ ...prev, issueDate: e.target.value }))}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500" required />
          </div>
          <div>
            <label htmlFor="expiryDate" className="block text-sm font-medium text-gray-700 mb-1">Expiry Date (Optional)</label>
            <input id="expiryDate" type="date" value={formData.expiryDate}
              onChange={e => setFormData(prev => ({ ...prev, expiryDate: e.target.value }))}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500" />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-600 mb-4">
              <XCircle className="w-5 h-5" /><p>{error}</p>
            </div>
          )}
          <div className="flex items-center justify-between pt-4">
            <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2">
              <Eye className="w-4 h-4" />Preview Certificate
            </button>
          </div>
        </form>
        {formData.issueDate && (
          <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-medium">Preview before issuance</p>
            <p className="mt-2 text-blue-700">Current draft issue date: {formatPreviewDate(formData.issueDate)}</p>
          </div>
        )}
      </div>
      <CertificatePreviewModal isOpen={isPreviewOpen} preview={previewData}
        isSubmitting={isSubmitting} onClose={() => setIsPreviewOpen(false)} onConfirm={handleConfirmIssue} />
    </div>
  );
};

export default IssueCertificate;