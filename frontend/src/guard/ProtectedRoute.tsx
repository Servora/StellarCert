import { Navigate, Outlet } from "react-router-dom";

// Define allowed routes based on user roles
const roleRoutes: Record<string, string[]> = {
  user: ["/wallet"],
  verifier: ["/wallet", "/verify"],
  issuer: ["/issue", "/wallet", "/revoke", "/verify"],
  admin: ["/issue", "/wallet", "/revoke", "/verify"],
};

// Define props type for ProtectedRoute
interface ProtectedRouteProps {
  allowedRoles: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const currentPath: string = window.location.pathname;

  // Allow public access to /verify
  if (currentPath === "/verify") return <Outlet />;

  // Retrieve user data from localStorage
  const userData = localStorage.getItem("user");
  const user = userData ? JSON.parse(userData) : null;

  // If no user is logged in, redirect to login page
  if (!user) return <Navigate to="/login" replace />;

  // Get user role and allowed routes
  const userRole: string = user.role;
  const allowedRoutes: string[] = roleRoutes[userRole] || [];

  // Check if the user is allowed to access the route
  if (!allowedRoutes.includes(currentPath)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
