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
  const { user, isAuthenticated, isLoading } = useAuth();

  // #1317: `/` and `/dashboard` render for anonymous visitors too (they
  // show the public feature-overview section below this route), so this
  // must not render a role dashboard - or fire its authenticated API
  // calls - before auth has resolved or when there is no session. Nothing
  // here means the marketing section is the only visible content.
  if (isLoading || !isAuthenticated || !user) {
    return null;
  }

  // UserRole.USER is the default role every public sign-up gets and is
  // treated as recipient-like everywhere else in the app (see
  // CertificateWallet.tsx's isRecipientUser check), so it belongs on the
  // recipient dashboard, not the issuer one. Issuer remains the fallback
  // for roles with no dedicated dashboard (issuer or auditor).
  const role =
    user.role === UserRole.ADMIN
      ? "admin"
      : user.role === UserRole.RECIPIENT || user.role === UserRole.USER
        ? "recipient"
        : user.role === UserRole.VERIFIER
          ? "verifier"
          : "issuer";

  return <RoleDashboard role={role} />;
};

export default Dashboard;
