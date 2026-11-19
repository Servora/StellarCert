import { Injectable } from '@nestjs/common';
import { Certificate } from '../entities/certificate.entity';
import { VerifiedCertificateData } from '../interfaces/verification-result.interface';

export interface CertificateResponseDto {
  id: string;
  certificateId: string;
  serialNumber: string; // alias for certificateId — used by frontend
  issuerId: string;
  issuerName?: string;
  issuerStellarAddress?: string;
  recipientName: string;
  recipientEmail: string;
  recipientStellarAddress?: string;
  title: string;
  courseName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  status: string;
  revocationReason?: string;
  revokedAt?: Date;
  stellarTransactionHash?: string;
  txHash?: string; // alias for stellarTransactionHash — used by frontend
  stellarMemo?: string;
  verificationCode?: string;
  verificationCount: number;
  qrCodeData?: string;
  pdfUrl?: string;
  issuedAt: Date;
  issueDate: string; // alias for issuedAt as ISO string — used by frontend
  expiresAt?: Date;
  expiryDate?: string; // alias for expiresAt as ISO string — used by frontend
  updatedAt: Date;
}

export interface VerificationResultDto {
  isValid: boolean;
  status: 'valid' | 'revoked' | 'expired' | 'frozen' | 'not_found';
  certificate?: CertificateResponseDto;
  verifiedAt: string;
  verificationDate: string;
  message: string;
  verificationId?: string;
}

export interface CertificateSummaryDto {
  id: string;
  certificateId: string;
  recipientName: string;
  recipientEmail: string;
  title: string;
  status: string;
  issuedAt: Date;
  expiresAt?: Date;
  hasStellarRecord: boolean;
}

/**
 * Public projection of a certificate (#1178): everything a stranger needs to
 * verify a credential, and nothing that identifies the recipient privately.
 * `recipientEmail` and `verificationCode` are deliberately absent — the code
 * is the credential-equivalent secret for verification-by-code lookups, and
 * the email is PII with no verification value.
 */
export interface PublicCertificateDto {
  publicId: string;
  title: string;
  courseName?: string;
  description?: string;
  recipientName: string;
  issuerName?: string;
  issuerStellarAddress?: string;
  status: 'valid' | 'revoked' | 'expired' | 'frozen';
  issuedAt: Date;
  expiresAt?: Date;
  verificationCount: number;
  chainProof: {
    anchored: boolean;
    transactionHash?: string;
    explorerUrl?: string;
  };
}

@Injectable()
export class CertificateMapper {
  toResponse(certificate: Certificate): CertificateResponseDto {
    const issuerName =
      certificate.issuerName ??
      (certificate.issuer
        ? `${certificate.issuer.firstName ?? ''} ${certificate.issuer.lastName ?? ''}`.trim()
        : undefined);
    const issuedAtIso = certificate.issuedAt
      ? new Date(certificate.issuedAt).toISOString()
      : new Date().toISOString();
    const expiresAtIso = certificate.expiresAt
      ? new Date(certificate.expiresAt).toISOString()
      : undefined;
    return {
      id: certificate.id,
      certificateId: certificate.certificateId,
      serialNumber: certificate.certificateId,
      issuerId: certificate.issuerId,
      issuerName,
      issuerStellarAddress:
        certificate.issuerStellarAddress ??
        certificate.issuer?.stellarPublicKey,
      recipientName: certificate.recipientName,
      recipientEmail: certificate.recipientEmail,
      recipientStellarAddress: certificate.recipientStellarAddress,
      title: certificate.title,
      courseName: (certificate as any).courseName,
      description: certificate.description,
      metadata: certificate.metadata as Record<string, unknown> | undefined,
      status: certificate.status,
      revocationReason: certificate.revocationReason,
      revokedAt: certificate.revokedAt,
      stellarTransactionHash: certificate.stellarTransactionHash,
      txHash: certificate.stellarTransactionHash,
      stellarMemo: certificate.stellarMemo,
      verificationCode: certificate.verificationCode,
      verificationCount: certificate.verificationCount,
      qrCodeData: certificate.qrCodeData,
      pdfUrl: certificate.pdfUrl,
      issuedAt: certificate.issuedAt,
      issueDate: issuedAtIso,
      expiresAt: certificate.expiresAt,
      expiryDate: expiresAtIso,
      updatedAt: certificate.updatedAt,
    };
  }

  toVerificationResult(
    certificate: Certificate | null,
    code: string,
  ): VerificationResultDto {
    const now = new Date().toISOString();
    if (!certificate) {
      return {
        isValid: false,
        status: 'not_found',
        verifiedAt: now,
        verificationDate: now,
        message: 'Certificate not found',
        verificationId: `ver_${Date.now()}`,
      };
    }
    const mapped = this.toResponse(certificate);
    const isExpired = certificate.expiresAt
      ? new Date() > new Date(certificate.expiresAt)
      : false;
    const isRevoked = certificate.status === 'revoked';
    // Frozen is a temporary hold, distinct from revoked: the holder should be
    // told the certificate is suspended rather than that it was withdrawn (or,
    // as before this was handled, that it does not exist at all).
    const isFrozen = certificate.status === 'frozen';
    const status = isRevoked
      ? 'revoked'
      : isFrozen
        ? 'frozen'
        : isExpired
          ? 'expired'
          : 'valid';
    return {
      isValid: status === 'valid',
      status,
      certificate: mapped,
      verifiedAt: now,
      verificationDate: now,
      message:
        status === 'valid'
          ? 'Certificate is valid and active'
          : status === 'revoked'
            ? 'Certificate has been revoked'
            : status === 'frozen'
              ? 'Certificate is temporarily frozen'
              : 'Certificate has expired',
      verificationId: `ver_${Date.now()}`,
    };
  }

  /**
   * #1178 — public share-page projection with the chain-proof panel data.
   * The Stellar Expert link is built here so the frontend never has to know
   * which network the issuer anchors on.
   */
  toPublicProjection(
    certificate: Certificate,
    network: 'public' | 'testnet' = 'public',
  ): PublicCertificateDto {
    const issuerName =
      certificate.issuerName ??
      (certificate.issuer
        ? `${certificate.issuer.firstName ?? ''} ${certificate.issuer.lastName ?? ''}`.trim()
        : undefined);

    const isExpired = certificate.expiresAt
      ? new Date() > new Date(certificate.expiresAt)
      : false;
    const isFrozen = certificate.status === 'frozen';
    const isRevoked = certificate.status === 'revoked';
    const status = isRevoked
      ? 'revoked'
      : isFrozen
        ? 'frozen'
        : isExpired
          ? 'expired'
          : 'valid';

    const txHash = certificate.stellarTransactionHash;

    return {
      publicId: certificate.certificateId,
      title: certificate.title,
      courseName: certificate.courseName,
      description: certificate.description,
      recipientName: certificate.recipientName,
      issuerName,
      issuerStellarAddress:
        certificate.issuerStellarAddress ??
        certificate.issuer?.stellarPublicKey,
      status,
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      verificationCount: certificate.verificationCount ?? 0,
      chainProof: {
        anchored: !!txHash,
        ...(txHash
          ? {
              transactionHash: txHash,
              explorerUrl: `https://stellar.expert/explorer/${network}/tx/${txHash}`,
            }
          : {}),
      },
    };
  }

  toSummary(certificate: Certificate): CertificateSummaryDto {
    return {
      id: certificate.id,
      certificateId: certificate.certificateId,
      recipientName: certificate.recipientName,
      recipientEmail: certificate.recipientEmail,
      title: certificate.title,
      status: certificate.status,
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      hasStellarRecord: !!certificate.stellarTransactionHash,
    };
  }

  toVerificationData(certificate: Certificate): VerifiedCertificateData {
    return {
      id: certificate.id,
      certificateId: certificate.certificateId,
      recipientName: certificate.recipientName,
      recipientEmail: certificate.recipientEmail,
      title: certificate.title,
      issuerName:
        certificate.issuerName ??
        (certificate.issuer
          ? `${certificate.issuer.firstName ?? ''} ${certificate.issuer.lastName ?? ''}`.trim()
          : undefined) ??
        'Unknown',
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt ?? null,
      status: certificate.status,
      verificationCount: certificate.verificationCount,
    };
  }

  toResponseList(
    certificates: Certificate[],
    total: number,
    page: number,
    limit: number,
  ) {
    return {
      data: certificates.map((c) => this.toSummary(c)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
