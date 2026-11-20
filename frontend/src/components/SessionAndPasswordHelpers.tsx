// Live password-strength feedback. Closes #1336.
//
// #1335 ("no 'this device' indicator") is already handled elsewhere:
// AccountSecurity.tsx renders a "This device" badge from the session's own
// `current` flag (added in #1403, merged before this PR). A client-side
// sessionId comparison here would be redundant with that server-provided
// flag, so no CurrentDeviceBadge component is added.
export const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "A number", test: (p: string) => /\d/.test(p) },
  { label: "A symbol", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const LEVELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];

// Renders live strength and which requirements are still missing as the user types.
export const PasswordStrengthMeter: React.FC<{ password: string }> = ({
  password,
}) => {
  const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;
  const level = LEVELS[Math.max(passed - 1, 0)];
  return (
    <div aria-live="polite" className="mt-1 text-xs">
      <div className="h-1 w-full rounded bg-gray-200">
        <div
          className="h-1 rounded bg-blue-600"
          style={{ width: `${(passed / PASSWORD_RULES.length) * 100}%` }}
        />
      </div>
      {password && <p className="mt-1">Strength: {level}</p>}
      <ul className="mt-1 space-y-0.5">
        {PASSWORD_RULES.map((r) => (
          <li
            key={r.label}
            className={r.test(password) ? "text-green-700" : "text-gray-500"}
          >
            {r.test(password) ? "✓" : "○"} {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
};
