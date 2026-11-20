import { UserRole } from "../api";
import { useAuth } from "../context/AuthContext";
import { createRoleDashboard } from "../components/TableAndDashboardHelpers";

// Each role's dashboard is its own lazy chunk (#1337): an admin visiting
// /dashboard no longer downloads and parses the recipient- and
// verifier-only code paths, and vice versa.
const RoleDashboard = createRoleDashboard({
  admin: () => import("./AdminAnalyticsDashboard"),
  recipient: () => import("./dashboard/RecipientDashboard"),
  verifier: () => import("./dashboard/VerifierDashboard"),
  issuer: () => import("./dashboard/IssuerDashboard"),
});

const Dashboard = () => {
  const { user } = useAuth();

  // Issuer is the fallback for any role without a dedicated dashboard
  // (issuer, auditor, user, or not yet loaded), matching the previous
  // runtime-if behaviour.
  const role =
    user?.role === UserRole.ADMIN
      ? "admin"
      : user?.role === UserRole.RECIPIENT
        ? "recipient"
        : user?.role === UserRole.VERIFIER
          ? "verifier"
          : "issuer";

  return <RoleDashboard role={role} />;
};

export default Dashboard;
