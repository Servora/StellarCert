import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LogIn, UserPlus, Shield, Eye, EyeOff, MailCheck } from "lucide-react";
import { authApi } from "../api";
import { useAuth } from "../context/AuthContext";
import { getSafeRedirectPath } from "../utils/redirect";

type LoadingPhase = "idle" | "registering" | "logging-in";

const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = getSafeRedirectPath(searchParams.get("returnUrl"));
  const { login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [showVerificationPending, setShowVerificationPending] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [formData, setFormData] = useState({
    email: "", password: "", confirmPassword: "",
    firstName: "", lastName: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isLogin) {
      if (formData.password !== formData.confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      if (formData.password.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
    }

    try {
      if (!isLogin) {
        setLoadingPhase("registering");
        const regRes = await authApi.register({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          password: formData.password,
        });
        
        // Check if email verification is required
        if (regRes.requiresEmailVerification) {
          // Store the access token (as mentioned in endpoints.ts comment)
          // but don't call login() - show verification pending screen instead
          setRegisteredEmail(formData.email);
          setShowVerificationPending(true);
        } else {
          // Email already verified or verification not required, log in normally
          login(regRes.accessToken, regRes.user);
          navigate(returnUrl, { replace: true });
        }
        return;
      }

      setLoadingPhase("logging-in");
      const res = await authApi.login({ email: formData.email, password: formData.password });
      if (res.accessToken) {
        login(res.accessToken, res.user);
        navigate(returnUrl, { replace: true });
      }
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Authentication failed.");
    } finally {
      setLoadingPhase("idle");
    }
  };

  const buttonLabel = () => {
    if (loadingPhase === "registering") return <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />Creating account…</>;
    if (loadingPhase === "logging-in") return <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />Signing in…</>;
    return isLogin ? <><LogIn className="w-4 h-4" />Sign In</> : <><UserPlus className="w-4 h-4" />Create Account</>;
  };

  // Render verification pending screen
  if (showVerificationPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-900">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 w-full max-w-md">
          <div className="flex justify-center mb-6">
            <MailCheck className="w-12 h-12 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-center mb-4 text-gray-900 dark:text-white">
            Check Your Email
          </h1>
          <p className="text-gray-600 dark:text-slate-300 text-center mb-6">
            We&apos;ve sent a verification link to <strong>{registeredEmail}</strong>.
            Please click the link in your email to verify your account before signing in.
          </p>
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-slate-700 rounded-lg p-4">
              <h3 className="font-medium text-blue-800 dark:text-blue-300 mb-2">What&apos;s next?</h3>
              <ul className="text-sm text-blue-700 dark:text-blue-200 space-y-1">
                <li>• Check your inbox (and spam folder) for our email</li>
                <li>• Click the verification link in the email</li>
                <li>• Return here to sign in to your account</li>
              </ul>
            </div>
            <button
              onClick={() => {
                setShowVerificationPending(false);
                setIsLogin(true);
                setFormData({ email: registeredEmail, password: "", confirmPassword: "", firstName: "", lastName: "" });
              }}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
            >
              Go to Sign In
            </button>
            <button
              onClick={() => {
                setShowVerificationPending(false);
                setIsLogin(false);
                setFormData({ email: "", password: "", confirmPassword: "", firstName: "", lastName: "" });
              }}
              className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-white rounded-md"
            >
              Register Another Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 w-full max-w-md">
        <div className="flex justify-center mb-6"><Shield className="w-12 h-12 text-blue-600 dark:text-blue-400" /></div>
        <h1 className="text-2xl font-bold text-center mb-8 text-gray-900 dark:text-white">
          {isLogin ? "Welcome Back" : "Create Account"}
        </h1>
        {error && <p className="text-red-600 dark:text-red-400 text-center mb-4">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-6">
          {!isLogin && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">First Name</label>
                <input type="text" value={formData.firstName}
                  onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                  className="w-full px-4 py-2 border rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-300 dark:border-slate-700" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Last Name</label>
                <input type="text" value={formData.lastName}
                  onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                  className="w-full px-4 py-2 border rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-300 dark:border-slate-700" required />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Email Address</label>
            <input type="email" value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-300 dark:border-slate-700" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Password</label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-2 border rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-300 dark:border-slate-700 pr-10" required />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Confirm Password</label>
              <input type={showPassword ? "text" : "password"} value={formData.confirmPassword}
                onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="w-full px-4 py-2 border rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white border-gray-300 dark:border-slate-700" required />
            </div>
          )}
          <button type="submit" disabled={loadingPhase !== "idle"}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-md flex items-center justify-center gap-2">
            {buttonLabel()}
          </button>
        </form>
        {isLogin && (
          <div className="mt-4 text-center">
            {!showForgot ? (
              <button onClick={() => setShowForgot(true)} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Forgot your password?
              </button>
            ) : (
              <div className="mt-4">
                <p className="text-sm text-gray-600 mb-2">Enter your account email to receive password reset instructions.</p>
                {forgotSuccess ? (
                  <div className="text-sm text-green-600">{forgotSuccess}</div>
                ) : (
                  <div className="flex gap-2">
                    <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                      placeholder="you@example.com" className="flex-1 px-3 py-2 border rounded-md dark:bg-slate-700 dark:border-slate-600 dark:text-white" />
                    <button onClick={async () => {
                      setForgotLoading(true); setError(null);
                      try {
                        await authApi.forgotPassword({ email: forgotEmail });
                        setForgotSuccess("If the email exists, a reset link has been sent.");
                      } catch (err: unknown) {
                        setError((err as { message?: string })?.message ?? "Failed to request password reset");
                      } finally { setForgotLoading(false); }
                    }} disabled={forgotLoading} className="px-3 py-2 bg-blue-600 text-white rounded-md disabled:opacity-60">
                      {forgotLoading ? "Sending…" : "Send"}
                    </button>
                  </div>
                )}
                <div className="mt-2">
                  <button onClick={() => setShowForgot(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-6 text-center">
          <button onClick={() => { setIsLogin(!isLogin); setError(null); }}
            className="text-blue-600 dark:text-blue-400 hover:underline">
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
