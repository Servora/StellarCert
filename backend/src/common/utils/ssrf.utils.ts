import * as dns from 'dns';
import * as net from 'net';
import { URL } from 'url';

/**
 * SSRF protection utilities for webhook URL validation.
 *
 * Resolves the hostname of a URL and rejects private, loopback,
 * link-local, and other internal IP ranges.
 */

// Private/reserved IP ranges (CIDR notation as [start, end] pairs)
const PRIVATE_RANGES: Array<[string, string]> = [
  // Loopback: 127.0.0.0/8
  ['127.0.0.0', '127.255.255.255'],
  // Link-local: 169.254.0.0/16
  ['169.254.0.0', '169.254.255.255'],
  // Private Class A: 10.0.0.0/8
  ['10.0.0.0', '10.255.255.255'],
  // Private Class B: 172.16.0.0/12
  ['172.16.0.0', '172.31.255.255'],
  // Private Class C: 192.168.0.0/16
  ['192.168.0.0', '192.168.255.255'],
  // Current network: 0.0.0.0/8
  ['0.0.0.0', '0.255.255.255'],
  // Carrier-grade NAT (CGNAT): 100.64.0.0/10
  ['100.64.0.0', '100.127.255.255'],
  // Documentation and benchmarking: 198.18.0.0/15
  ['198.18.0.0', '198.19.255.255'],
  // Multicast: 224.0.0.0/4 (Class D)
  ['224.0.0.0', '239.255.255.255'],
  // Reserved: 240.0.0.0/4 (Class E)
  ['240.0.0.0', '255.255.255.255'],
];

// IPv6 reserved ranges
const PRIVATE_IPV6_RANGES: Array<[bigint, bigint]> = [
  // Loopback: ::1/128
  [0x00000000000000000000000000000001n, 0x00000000000000000000000000000001n],
  // Link-local: fe80::/10
  [0xfe800000000000000000000000000000n, 0xfebfffffffffffffffffffffffffffffffn],
  // Site-local: fec0::/10
  [0xfec00000000000000000000000000000n, 0xfeffffffffffffffffffffffffffffffffn],
  // Unique Local Addresses: fc00::/7
  [0xfc000000000000000000000000000000n, 0xfdffffffffffffffffffffffffffffffn],
  // Unspecified address: ::/128
  [0x00000000000000000000000000000000n, 0x00000000000000000000000000000000n],
  // Multicast: ff00::/8
  [0xff000000000000000000000000000000n, 0xffffffffffffffffffffffffffffffffn],
];

function ipToNumber(ip: string): number {
  return (
    ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  );
}

function ipv6ToBigInt(ip: string): bigint {
  const expanded = expandIPv6(ip);
  const parts = expanded.split(':');
  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) + BigInt(parseInt(part, 16));
  }
  return result;
}

function expandIPv6(ip: string): string {
  // Handle IPv4-mapped IPv6 addresses
  if (ip.includes('.')) {
    const parts = ip.split(':');
    const ipv4 = parts[parts.length - 1];
    const ipv4Parts = ipv4.split('.');
    const hex1 = (
      (parseInt(ipv4Parts[0]) << 8) +
      parseInt(ipv4Parts[1])
    ).toString(16);
    const hex2 = (
      (parseInt(ipv4Parts[2]) << 8) +
      parseInt(ipv4Parts[3])
    ).toString(16);
    const prefix = parts.slice(0, -1).join(':');
    return prefix ? `${prefix}:${hex1}:${hex2}` : `::${hex1}:${hex2}`;
  }

  // Handle :: shorthand
  if (ip.includes('::')) {
    const halves = ip.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0000');
    return [...left, ...middle, ...right]
      .map((p) => p.padStart(4, '0'))
      .join(':');
  }

  return ip
    .split(':')
    .map((p) => p.padStart(4, '0'))
    .join(':');
}

function isIPv4Private(ip: string): boolean {
  const num = ipToNumber(ip);
  return PRIVATE_RANGES.some(([start, end]) => {
    return num >= ipToNumber(start) && num <= ipToNumber(end);
  });
}

function isIPv6Private(ip: string): boolean {
  const num = ipv6ToBigInt(ip);
  return PRIVATE_IPV6_RANGES.some(([start, end]) => {
    return num >= start && num <= end;
  });
}

function isReservedIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isIPv4Private(ip);
  }
  if (net.isIPv6(ip)) {
    return isIPv6Private(ip);
  }
  return false;
}

export interface SsrfValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that a URL is safe to make outbound HTTP requests to.
 * Rejects:
 * - Non-HTTPS URLs
 * - Private/link-local/loopback IP addresses
 * - Hostnames that resolve to private IPs
 * - Data URIs, file URIs, and other non-HTTP schemes
 */
export async function validateWebhookUrl(
  urlString: string,
): Promise<SsrfValidationResult> {
  let url: URL;

  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow HTTPS
  if (url.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTPS URLs are allowed for webhooks' };
  }

  const hostname = url.hostname;

  // Block localhost variations
  const blockedHostnames = [
    'localhost',
    '0.0.0.0',
    '[::]',
    '[::1]',
    '127.0.0.1',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal', // GCP metadata
    '169.254.169.254.nip.io',
  ];

  if (blockedHostnames.includes(hostname.toLowerCase())) {
    return { valid: false, error: 'This hostname is not allowed for webhooks' };
  }

  // Resolve DNS and check resolved IPs
  try {
    const resolvedAddresses = await resolveHost(hostname);

    for (const addr of resolvedAddresses) {
      if (isReservedIP(addr)) {
        return {
          valid: false,
          error: `Resolved address ${addr} is in a reserved/private range and is not allowed`,
        };
      }
    }
  } catch {
    return { valid: false, error: 'Unable to resolve hostname' };
  }

  return { valid: true };
}

/**
 * Resolve a hostname to its IP addresses (both IPv4 and IPv6)
 */
function resolveHost(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const results: string[] = [];
    let pending = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      if (pending === 0) {
        done = true;
        if (results.length === 0) {
          reject(new Error('No addresses resolved'));
        } else {
          resolve(results);
        }
      }
    };

    pending++;
    dns.resolve4(hostname, (err, addresses) => {
      if (!err && addresses) {
        results.push(...addresses);
      }
      pending--;
      finish();
    });

    pending++;
    dns.resolve6(hostname, (err, addresses) => {
      if (!err && addresses) {
        results.push(...addresses);
      }
      pending--;
      finish();
    });
  });
}

/**
 * Synchronous check for obviously private hostnames/IPs (used as an additional
 * fast check alongside the async resolve-based check).
 */
export function isPrivateHostSync(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (blockedHostnames.includes(lower)) return true;
  if (net.isIPv4(lower)) return isIPv4Private(lower);
  if (net.isIPv6(lower)) return isIPv6Private(lower);
  return false;
}

const blockedHostnames: string[] = [
  'localhost',
  '0.0.0.0',
  '[::]',
  '[::1]',
  '127.0.0.1',
  '169.254.169.254',
  'metadata.google.internal',
  '169.254.169.254.nip.io',
];
