import { Link } from 'react-router-dom';
import { Award, Search, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dailyCertificateVerification, totalActiveUsers, totalCertificates } from '../api/endpoints';

const Dashboard = () => {
  const [totalCert, setTotalCert] = useState(0);
  const [totalVerification, setTotalVerification] = useState(0);
  const [totalActiveUsersCount, setTotalActiveUsersCount] = useState(0);

  useEffect(() => {
    getTotalCertificates();
    getDailyVerification();
    getTotalActiveUsers();
  }, []);

  const getTotalCertificates = async () => {
    const res = await totalCertificates();
    if (res?.total) {
      setTotalCert(res.total);
    }
  };

  const getDailyVerification = async () => {
    const res = await dailyCertificateVerification();
    if (res?.count) {
      setTotalVerification(res.count);
    }
  };

  const getTotalActiveUsers = async () => {
    const res = await totalActiveUsers();
    if (res?.total) {
      setTotalActiveUsersCount(res.total);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-2">Total Certificates</h2>
          <p className="text-3xl font-bold text-blue-600">{totalCert}</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-2">Verifications Today</h2>
          <p className="text-3xl font-bold text-green-600">{totalVerification}</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-2">Active Users</h2>
          <p className="text-3xl font-bold text-purple-600">{totalActiveUsersCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link to="/issue" className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
          <Award className="w-12 h-12 text-blue-600 mb-4" />
          <h3 className="text-xl font-semibold mb-2">Issue Certificate</h3>
          <p className="text-gray-600">Create and issue new digital certificates</p>
        </Link>

        <Link to="/verify" className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
          <Search className="w-12 h-12 text-green-600 mb-4" />
          <h3 className="text-xl font-semibold mb-2">Verify Certificate</h3>
          <p className="text-gray-600">Verify the authenticity of certificates</p>
        </Link>

        <Link to="/wallet" className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
          <Wallet className="w-12 h-12 text-purple-600 mb-4" />
          <h3 className="text-xl font-semibold mb-2">Certificate Wallet</h3>
          <p className="text-gray-600">View and manage your certificates</p>
        </Link>
      </div>
    </div>
  );
};

export default Dashboard;
