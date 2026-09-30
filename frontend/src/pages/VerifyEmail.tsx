import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { getErrorMessage } from "../api/types";
import { useVerifyEmailMutation } from "../api/queries";

type VerificationState = "loading" | "success" | "error";

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  // `mutate` is referentially stable, so it is safe as an effect dependency and
  // does not re-submit the token when the mutation's state changes.
  const { mutate, isIdle, isPending, isError, error, data } = useVerifyEmailMutation();

  // Confirming an address is a one-shot command, not cached server state, so it
  // is a mutation. The mutation owns the pending/error state, which removes the
  // isMounted flag this used to need to avoid setting state after unmount.
  //
  // The ref guards the submit so StrictMode's double effect invocation (and any
  // re-render) cannot spend the same one-time token twice.
  const submittedToken = useRef<string | null>(null);
  useEffect(() => {
    if (!token || submittedToken.current === token) return;
    submittedToken.current = token;
    mutate({ token });
  }, [token, mutate]);

  // `isIdle` is true for the first render, before the effect above has submitted
  // the token. That is still "in progress" as far as the user is concerned: the
  // address has not been confirmed yet, so it must not read as a success.
  const inProgress = isIdle || isPending;

  const state: VerificationState = !token
    ? "error"
    : inProgress
      ? "loading"
      : isError
        ? "error"
        : "success";

  const message = !token
    ? "Verification token is missing."
    : inProgress
      ? "Verifying your email address..."
      : isError
        ? getErrorMessage(error)
        : (data?.message || "Email verified successfully.");

  const icon =
    state === "loading" ? (
      <Loader2 className="h-10 w-10 animate-spin text-blue-600 dark:text-blue-400" />
    ) : state === "success" ? (
      <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
    ) : (
      <XCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
    );

  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <section className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md dark:bg-slate-800">
        <div className="mb-4 flex justify-center">{icon}</div>
        <h1 className="mb-3 text-2xl font-bold text-gray-900 dark:text-white">
          Email Verification
        </h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-slate-300">
          {message}
        </p>
        {state !== "loading" && (
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
          >
            Go to login
          </Link>
        )}
      </section>
    </main>
  );
};

export default VerifyEmail;
