import { StellarNetwork } from '../dto/address-validation.dto';

export interface HorizonAccountResponse {
  id: string;
  sequence: string;
  subentry_count: number;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  flags: {
    auth_required: boolean;
    auth_revocable: boolean;
    auth_immutable: boolean;
  };
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
    limit?: string;
    buying_liabilities?: string;
    selling_liabilities?: string;
    last_modified_ledger?: number;
    is_authorized?: boolean;
    is_authorized_to_maintain_liabilities?: boolean;
  }>;
  signers: Array<{
    key: string;
    weight: number;
    type?: string;
  }>;
  data?: Array<{
    name: string;
    value: string;
  }>;
  links: {
    self: {
      href: string;
    };
    transactions: {
      href: string;
    };
    operations: {
      href: string;
    };
    payments: {
      href: string;
    };
    effects: {
      href: string;
    };
    offers: {
      href: string;
    };
    trades: {
      href: string;
    };
    data: {
      href: string;
    };
  };
  paging_token: string;
  last_modified_ledger: number;
  created_at: string;
}

export interface AddressValidationOptions {
  network: StellarNetwork;
  checkExists: boolean;
  cacheResults: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  isFormatValid: boolean;
  isChecksumValid: boolean;
  isNetworkValid: boolean;
  accountExists?: boolean;
  accountDetails?: HorizonAccountResponse;
}

export interface CacheEntry {
  isValid: boolean;
  accountExists?: boolean;
  accountDetails?: HorizonAccountResponse;
  timestamp: number;
  ttl: number;
}

export interface StellarConfig {
  horizonUrls: {
    public: string;
    testnet: string;
  };
  cache: {
    ttl: number; // Time to live in milliseconds
    maxSize: number; // Maximum number of cached entries
  };
  rateLimit: {
    requestsPerSecond: number;
    burstSize: number;
  };
}
