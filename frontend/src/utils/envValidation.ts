// Frontend environment validation
// Validates required VITE_* environment variables and provides defaults for non-critical ones.

interface ValidatedEnv {
  VITE_API_URL: string;
  VITE_STELLAR_NETWORK: string;
  VITE_HORIZON_URL: string;
  VITE_ENABLE_NOTIFICATIONS: string;
  VITE_ENABLE_METRICS: string;
  VITE_USE_DUMMY_DATA: string;
}

export function validateFrontendEnv(): ValidatedEnv {
  // Required variables
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    throw new Error("VITE_API_URL is required but not set.");
  }
  // Validate that it's a valid URL
  try {
    new URL(apiUrl);
  } catch {
    throw new Error(`VITE_API_URL must be a valid URL: ${apiUrl}`);
  }

  // Optional variables with safe defaults
  const stellarNetwork = import.meta.env.VITE_STELLAR_NETWORK || "testnet";
  const horizonUrl =
    import.meta.env.VITE_HORIZON_URL || "https://horizon-testnet.stellar.org";
  const enableNotifications =
    import.meta.env.VITE_ENABLE_NOTIFICATIONS || "true";
  const enableMetrics = import.meta.env.VITE_ENABLE_METRICS || "true";
  const useDummyData = import.meta.env.VITE_USE_DUMMY_DATA || "false";

  return {
    VITE_API_URL: apiUrl,
    VITE_STELLAR_NETWORK: stellarNetwork,
    VITE_HORIZON_URL: horizonUrl,
    VITE_ENABLE_NOTIFICATIONS: enableNotifications,
    VITE_ENABLE_METRICS: enableMetrics,
    VITE_USE_DUMMY_DATA: useDummyData,
  };
}
