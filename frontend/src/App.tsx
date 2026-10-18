import { Routes, Route, useLocation } from "react-router-dom";
import { Suspense, lazy } from "react";
import { Shield, Award, Search, ShieldAlert } from "lucide-react";
import Navbar from "./components/Header";
import ErrorBoundary from "./components/ErrorBoundary";
import ProtectedRoute from "./guard/ProtectedRoute";
import { NotificationProvider } from "./context/NotificationContext";
import { AuthProvider } from "./context/AuthContext";
import ToastContainer from "./components/Toast";
import { UserRole } from "./api";
import { WALLET_ALLOWED_ROLES } from "./constants/routeAccess";

// Lazy load page components for code splitting
const Dashboard = lazy(() => import("./pages/Dashboard"));
const IssueCertificate = lazy(() => import("./pages/IssueCertificate"));
const VerifyCertificate = lazy(() => import("./pages/VerifyCertificate"));
const CertificateWallet = lazy(() => import("./pages/CertificateWallet"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const Login = lazy(() => import("./pages/Login"));
const RevokeCertificatePage = lazy(() => import("./pages/RevokeCertificate"));
const IssuerProfile = lazy(() => import("./pages/IssuerProfile"));
const CertificateManagementPage = lazy(
  () => import("./pages/CertificateManagement"),
);
const NotificationPreferences = lazy(
  () => import("./pages/NotificationPreferences"),
);
const NotFound = lazy(() => import("./pages/NotFound"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

function App() {
  const location = useLocation();
  const showFeatureOverview =
    location.pathname === "/" || location.pathname === "/dashboard";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 transition-colors duration-250">
      <AuthProvider>
        <NotificationProvider>
          <Navbar />
          <div className="container mx-auto px-4 py-8">
            {/*
              Route-level error boundary. Every page below is a `React.lazy`
              chunk, so a chunk that fails to load (unresolvable module — the
              casing defect in #744 — a stale hashed asset after a deploy, or
              an offline client) rejects the import promise. React re-throws
              that rejection during render; with no boundary above it, the
              whole tree unmounts and the user gets a blank screen instead of
              the 404 page the catch-all route below should have rendered.
            */}
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/verify" element={<VerifyCertificate />} />
                  <Route path="/verify-email" element={<VerifyEmail />} />
                  <Route path="/reset-password" element={<ResetPassword />} />

                  <Route
                    element={<ProtectedRoute allowedRoles={[...WALLET_ALLOWED_ROLES]} />}
                  >
                    <Route path="/wallet" element={<CertificateWallet />} />
                  </Route>

                  <Route
                    element={
                      <ProtectedRoute
                        allowedRoles={[UserRole.ISSUER, UserRole.ADMIN]}
                      />
                    }
                  >
                    <Route path="/issue" element={<IssueCertificate />} />
                    <Route path="/revoke" element={<RevokeCertificatePage />} />
                    <Route
                      path="/certificates"
                      element={<CertificateManagementPage />}
                    />
                  </Route>

                  {/* Admin-only routes */}
                  <Route
                    element={
                      <ProtectedRoute allowedRoles={[UserRole.ADMIN]} />
                    }
                  >
                    <Route path="/admin/users" element={<AdminUsers />} />
                  </Route>

                  {/* Account routes — any authenticated user, regardless of role */}
                  <Route
                    element={
                      <ProtectedRoute
                        allowedRoles={[
                          UserRole.RECIPIENT,
                          UserRole.VERIFIER,
                          UserRole.ISSUER,
                          UserRole.ADMIN,
                          UserRole.AUDITOR,
                          UserRole.USER,
                        ]}
                      />
                    }
                  >
                    <Route path="/profile" element={<IssuerProfile />} />
                    <Route
                      path="/preferences"
                      element={<NotificationPreferences />}
                    />
                  </Route>

                  {/* Catch-all: must be last */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </div>

          {/* Feature Overview Section */}
          {showFeatureOverview && (
            <section className="bg-white dark:bg-slate-900 py-12 mt-8 transition-colors duration-250">
              <div className="container mx-auto px-4">
                <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-white">
                  Secure Certificate Management
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  <div className="text-center p-6 rounded-lg dark:bg-slate-800 transition-colors duration-250">
                    <Shield className="w-12 h-12 mx-auto text-blue-600 dark:text-blue-400 mb-4" />
                    <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
                      Tamper-Proof
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400">
                      Blockchain-backed certificates that cannot be altered or
                      forged
                    </p>
                  </div>
                  <div className="text-center p-6 rounded-lg dark:bg-slate-800 transition-colors duration-250">
                    <Award className="w-12 h-12 mx-auto text-blue-600 dark:text-blue-400 mb-4" />
                    <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
                      Easy Issuance
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400">
                      Issue digital certificates with custom templates and
                      branding
                    </p>
                  </div>
                  <div className="text-center p-6 rounded-lg dark:bg-slate-800 transition-colors duration-250">
                    <Search className="w-12 h-12 mx-auto text-blue-600 dark:text-blue-400 mb-4" />
                    <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
                      Instant Verification
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400">
                      Verify certificates instantly with unique identifiers
                    </p>
                  </div>
                  <div className="text-center p-6 border rounded-lg bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 transition-colors duration-250">
                    <ShieldAlert className="w-12 h-12 mx-auto text-red-600 dark:text-red-400 mb-4" />
                    <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
                      Revocation List
                    </h3>
                    <p className="text-gray-600 dark:text-slate-400">
                      Real-time certificate revocation with Merkle tree
                      optimization
                    </p>
                    <div className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                      CRL Active
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
          <ToastContainer />
        </NotificationProvider>
      </AuthProvider>
    </div>
  );
}

export default App;
