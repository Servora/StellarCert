import { useEffect, useState } from 'react';
import { Wallet, Download, Eye, Clock } from 'lucide-react';
import type { Certificate } from '../types';
import { getUserCertificates } from '../api/endpoints';

const CertificateWallet = () => {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  // const userId = "b3a1863c-15a9-4df1-989e-a9d4e4f3840e";
  useEffect(() => {
    const user = localStorage.getItem('user');
    
    if (!user) {
      setLoading(false);
      return;
    }
  
    const parsedUser = JSON.parse(user); // Parse the stored string into an object
  
    const fetchCertificates = async () => {
      try {
        const data = await getUserCertificates(parsedUser.id); 
        if (data) {
          setCertificates(data);
        }
      } catch (error) {
        console.error('Error fetching certificates:', error);
      } finally {
        setLoading(false);
      }
    };
  
    fetchCertificates();
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Wallet className="w-10 h-10 text-blue-600" />
        <h1 className="text-3xl font-bold">Certificate Wallet</h1>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading certificates...</p>
        </div>
      ) : certificates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow-md">
          <Wallet className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-600">No Certificates Yet</h2>
          <p className="text-gray-500 mt-2">Your earned certificates will appear here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {certificates.map((cert) => (
            <div key={cert.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-semibold text-gray-800">{cert.title}</h3>
                <span className={`px-2 py-1 rounded text-sm ${
                  cert.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {cert.status}
                </span>
              </div>

              <div className="space-y-2 mb-6">
                <p className="text-gray-600">Issued to: {cert.recipientName}</p>
                <p className="text-gray-600 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {new Date(cert.issueDate).toLocaleDateString()}
                </p>
              </div>

              <div className="flex justify-between">
                <a
                  href={cert.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
                >
                  <Eye className="w-4 h-4" />
                  View
                </a>
                <a
                  href={cert.pdfUrl}
                  download
                  className="flex items-center gap-2 text-green-600 hover:text-green-700"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CertificateWallet;