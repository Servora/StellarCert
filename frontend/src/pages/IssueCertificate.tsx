import { useState } from 'react';
import { Award, Upload, XCircle } from 'lucide-react';
import { createCertificate, fetchDefaultTemplate, fetchUserByEmail } from '../api/endpoints';
import { useNavigate } from 'react-router-dom';

const IssueCertificate = () => {
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    recipientName: '',
    recipientEmail: '',
    courseName: '',
    issuerName: '',
    issuerEmail: '',
    issueDate: '',
    expiryDate: '',
    issuerId: '',
    recipientId: '',
    templateId: ''
  });

  const navigate = useNavigate();

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    try {
      // Fetch recipient and issuer details
      const recipient = await fetchUserByEmail(formData.recipientEmail);
      const issuer = await fetchUserByEmail(formData.issuerEmail);
      const template = await fetchDefaultTemplate();

      if (!recipient) {
        setError("Failed to fetch recipient details. Please Recheck Email");
        return;
      };

      if (!issuer) {
        setError("Failed to fetch Issuer details. Please Recheck Email");
        return;
      };

      if (!template) {
        setError("Failed to fetch template.");
        return;
      }


      // Set recipientId and issuerId
      setFormData((prev) => ({
        ...prev,
        recipientId: recipient.id,
        issuerId: issuer.id,
        templateId: template.id
      }));

      const certificateData = {
        title: `${formData.courseName} Certificate`,
        description: `This certificate is awarded for completing the ${formData.courseName} course`,
        issuerName: formData.issuerName,
        recipientName: formData.recipientName,
        recipientEmail: formData.recipientEmail,
        issueDate: formData.issueDate,
        expiryDate: formData.expiryDate || null,
        issuerId: issuer.id,
        recipientId: recipient.id,
        templateId: template.id,
        metadata: {
          grade: 'A',
          courseName: formData.courseName
        }
      };

      console.log('Request Payload:', certificateData);
      const res = await createCertificate(certificateData);
      
      if(!res){
        setError("Failed to create Certificate");
        return;
      }
      navigate("/");
    } catch (error) {
      console.error('Error issuing certificate:', error);
      setError('Failed to issue certificate');
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Award className="w-10 h-10 text-blue-600" />
        <h1 className="text-3xl font-bold">Issue Certificate</h1>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Name</label>
            <input
              type="text"
              value={formData.recipientName}
              onChange={(e) => setFormData({ ...formData, recipientName: e.target.value })}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Email</label>
            <input
              type="email"
              value={formData.recipientEmail}
              onChange={(e) => setFormData({ ...formData, recipientEmail: e.target.value })}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Issuer Name</label>
            <input
              type="text"
              value={formData.issuerName}
              onChange={(e) => setFormData({ ...formData, issuerName: e.target.value })}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Issuer Email</label>
            <input
              type="email"
              value={formData.issuerEmail}
              onChange={(e) => setFormData({ ...formData, issuerEmail: e.target.value })}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
            <input
              type="text"
              value={formData.courseName}
              onChange={(e) => setFormData({ ...formData, courseName: e.target.value })}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Issue Date</label>
            <input
              type="date"
              value={formData.issueDate}
              onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date (Optional)</label>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
              className="w-full px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Issue Certificate
            </button>
          </div>
        </form>
        {error && (
          <div className="flex items-center gap-2 text-red-600 mb-4">
            <XCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default IssueCertificate;