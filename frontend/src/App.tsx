import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Shield, Award, Search } from 'lucide-react';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import IssueCertificate from './pages/IssueCertificate';
import VerifyCertificate from './pages/VerifyCertificate';
import CertificateWallet from './pages/CertificateWallet';
import Login from './pages/Login';
import RevokeCertificatePage from './pages/RevokeCertificate';
import ProtectedRoute from './guard/protectedRoute';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto px-4 py-8">

          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/verify" element={<VerifyCertificate />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute allowedRoles={["user", "verifier", "issuer", "admin"]} />}>
              <Route path="/wallet" element={<CertificateWallet />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["issuer", "admin"]} />}>
              <Route path="/issue" element={<IssueCertificate />} />
              <Route path="/revoke" element={<RevokeCertificatePage />} />
            </Route>
          </Routes>
        
        </div>
        
        {/* Feature Overview Section */}
        <section className="bg-white py-12 mt-8">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-center mb-12">Secure Certificate Management</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center p-6">
                <Shield className="w-12 h-12 mx-auto text-blue-600 mb-4" />
                <h3 className="text-xl font-semibold mb-2">Tamper-Proof</h3>
                <p className="text-gray-600">Blockchain-backed certificates that cannot be altered or forged</p>
              </div>
              <div className="text-center p-6">
                <Award className="w-12 h-12 mx-auto text-blue-600 mb-4" />
                <h3 className="text-xl font-semibold mb-2">Easy Issuance</h3>
                <p className="text-gray-600">Issue digital certificates with custom templates and branding</p>
              </div>
              <div className="text-center p-6">
                <Search className="w-12 h-12 mx-auto text-blue-600 mb-4" />
                <h3 className="text-xl font-semibold mb-2">Instant Verification</h3>
                <p className="text-gray-600">Verify certificates instantly with unique identifiers</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Router>
  );
}

export default App;