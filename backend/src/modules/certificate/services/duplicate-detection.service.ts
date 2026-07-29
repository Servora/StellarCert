import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Certificate } from '../entities/certificate.entity';
import {
  DuplicateCheckResult,
  DuplicateMatch,
  DuplicateRule,
  DuplicateDetectionConfig,
  OverrideRequest,
} from '../interfaces/duplicate-detection.interface';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class DuplicateDetectionService {
  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {}

  async checkForDuplicates(
    certificateData: Partial<Certificate>,
    config: DuplicateDetectionConfig,
  ): Promise<DuplicateCheckResult> {
    if (!config.enabled) {
      return {
        isDuplicate: false,
        confidence: 0,
        matches: [],
        action: 'allow',
      };
    }

    // Apply environment-based configuration overrides
    const effectiveConfig = this.applyEnvironmentConfig(config);

    const matches: DuplicateMatch[] = [];
    let maxConfidence = 0;

    for (const rule of effectiveConfig.rules.filter((r) => r.enabled)) {
      const ruleMatches = await this.applyRule(certificateData, rule);
      matches.push(...ruleMatches);

      if (ruleMatches.length > 0) {
        const ruleConfidence = Math.max(
          ...ruleMatches.map((m) => m.similarityScore),
        );
        maxConfidence = Math.max(maxConfidence, ruleConfidence);
      }
    }

    // Use configured threshold or default to 0.7
    const threshold =
      this.configService.get<number>('DUPLICATE_DETECTION_THRESHOLD') ?? 0.7;
    const isDuplicate = matches.length > 0 && maxConfidence >= threshold;
    let action: 'block' | 'warn' | 'allow' = effectiveConfig.defaultAction;

    if (isDuplicate) {
      const highestPriorityRule = effectiveConfig.rules
        .filter((r) => r.enabled)
        .sort((a, b) => b.priority - a.priority)[0];

      action = highestPriorityRule?.action || effectiveConfig.defaultAction;
    }

    return {
      isDuplicate,
      confidence: maxConfidence,
      matches,
      action,
      message: this.generateDuplicateMessage(matches, action),
    };
  }

  /**
   * Apply environment variable configuration overrides to the detection config
   */
  private applyEnvironmentConfig(
    config: DuplicateDetectionConfig,
  ): DuplicateDetectionConfig {
    const envThreshold = this.configService.get<number>(
      'DUPLICATE_DETECTION_THRESHOLD',
    );
    const envFuzzyMatching = this.configService.get<boolean>(
      'DUPLICATE_DETECTION_FUZZY_MATCHING',
    );
    const envTimeWindow = this.configService.get<number>(
      'DUPLICATE_DETECTION_TIME_WINDOW_DAYS',
    );

    // Create a deep copy of the config
    const effectiveConfig = JSON.parse(
      JSON.stringify(config),
    ) as DuplicateDetectionConfig;

    // Apply environment overrides to all rules
    effectiveConfig.rules = effectiveConfig.rules.map((rule) => ({
      ...rule,
      threshold: envThreshold ?? rule.threshold,
      fuzzyMatching: envFuzzyMatching ?? rule.fuzzyMatching,
      timeWindow: envTimeWindow ?? rule.timeWindow,
    }));

    return effectiveConfig;
  }

  private async applyRule(
    certificateData: Partial<Certificate>,
    rule: DuplicateRule,
  ): Promise<DuplicateMatch[]> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .where('certificate.status != :status', { status: 'revoked' });

    if (rule.timeWindow) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - rule.timeWindow);
      queryBuilder.andWhere('certificate.issuedAt >= :cutoffDate', {
        cutoffDate,
      });
    }

    const certificates = await queryBuilder.getMany();
    const matches: DuplicateMatch[] = [];

    for (const cert of certificates) {
      const similarityScore = this.calculateSimilarity(
        certificateData,
        cert,
        rule,
      );

      if (similarityScore >= rule.threshold) {
        matches.push({
          certificateId: cert.id,
          issuerId: cert.issuerId,
          recipientEmail: cert.recipientEmail,
          recipientName: cert.recipientName,
          title: cert.title,
          issuedAt: cert.issuedAt,
          similarityScore,
          matchType: this.getMatchType(certificateData, cert, rule),
        });
      }
    }

    return matches;
  }

  private calculateSimilarity(
    newData: Partial<Certificate>,
    existingCert: Certificate,
    rule: DuplicateRule,
  ): number {
    let totalScore = 0;
    let fieldCount = 0;

    for (const field of rule.checkFields) {
      const newValue = newData[field];
      const existingValue = existingCert[field];

      if (newValue && existingValue) {
        let fieldScore = 0;

        if (rule.fuzzyMatching) {
          fieldScore = this.fuzzyMatch(
            newValue.toString(),
            existingValue.toString(),
          );
        } else {
          fieldScore =
            newValue.toString().toLowerCase() ===
            existingValue.toString().toLowerCase()
              ? 1
              : 0;
        }

        totalScore += fieldScore;
        fieldCount++;
      }
    }

    return fieldCount > 0 ? totalScore / fieldCount : 0;
  }

  private fuzzyMatch(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1;

    // Email similarity
    if (s1.includes('@') && s2.includes('@')) {
      const email1 = s1.split('@');
      const email2 = s2.split('@');

      if (email1[1] === email2[1]) {
        // Same domain
        const localSimilarity = this.levenshteinSimilarity(
          email1[0],
          email2[0],
        );
        return localSimilarity * 0.8 + 0.2; // Boost for same domain
      }
    }

    // Name similarity
    if (!s1.includes('@') && !s2.includes('@')) {
      return this.levenshteinSimilarity(s1, s2);
    }

    // General string similarity
    return this.levenshteinSimilarity(s1, s2);
  }

  private levenshteinSimilarity(str1: string, str2: string): number {
    const matrix: number[][] = [];
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    const distance = matrix[len2][len1];
    const maxLength = Math.max(len1, len2);
    return maxLength === 0 ? 1 : 1 - distance / maxLength;
  }

  private getMatchType(
    newData: Partial<Certificate>,
    existingCert: Certificate,
    rule: DuplicateRule,
  ): 'exact' | 'fuzzy_email' | 'fuzzy_name' | 'fuzzy_title' {
    if (!rule.fuzzyMatching) return 'exact';

    const emailMatch = this.fuzzyMatch(
      newData.recipientEmail || '',
      existingCert.recipientEmail,
    );
    const nameMatch = this.fuzzyMatch(
      newData.recipientName || '',
      existingCert.recipientName,
    );
    const titleMatch = this.fuzzyMatch(newData.title || '', existingCert.title);

    if (emailMatch >= 0.9) return 'fuzzy_email';
    if (nameMatch >= 0.9) return 'fuzzy_name';
    if (titleMatch >= 0.9) return 'fuzzy_title';

    return 'exact';
  }

  private generateDuplicateMessage(
    matches: DuplicateMatch[],
    action: 'block' | 'warn' | 'allow',
  ): string {
    if (matches.length === 0) return '';

    const count = matches.length;
    const highestMatch = matches.reduce((prev, current) =>
      prev.similarityScore > current.similarityScore ? prev : current,
    );

    switch (action) {
      case 'block':
        return `Certificate issuance blocked: Found ${count} potential duplicate(s) with up to ${Math.round(highestMatch.similarityScore * 100)}% similarity.`;
      case 'warn':
        return `Warning: Found ${count} potential duplicate(s) with up to ${Math.round(highestMatch.similarityScore * 100)}% similarity. Proceed with caution.`;
      default:
        return '';
    }
  }

  async generateDuplicateReport(startDate: Date, endDate: Date): Promise<any> {
    const duplicates = await this.certificateRepository
      .createQueryBuilder('certificate')
      .where('certificate.isDuplicate = :isDuplicate', { isDuplicate: true })
      .andWhere('certificate.issuedAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .getMany();

    const duplicatesByIssuer = duplicates.reduce(
      (acc: Record<string, number>, cert) => {
        acc[cert.issuerId] = (acc[cert.issuerId] || 0) + 1;
        return acc;
      },
      {},
    );

    const duplicatesByType = duplicates.reduce(
      (acc: Record<string, number>, cert) => {
        const type = cert.duplicateOfId ? 'exact' : 'fuzzy';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      {},
    );

    return {
      id: `report_${Date.now()}`,
      totalDuplicates: duplicates.length,
      duplicatesByIssuer,
      duplicatesByType,
      timeRange: { start: startDate, end: endDate },
      generatedAt: new Date(),
      duplicates: duplicates.map((cert) => ({
        certificateId: cert.id,
        issuerId: cert.issuerId,
        recipientEmail: cert.recipientEmail,
        recipientName: cert.recipientName,
        title: cert.title,
        issuedAt: cert.issuedAt,
        similarityScore: 1,
        matchType: cert.duplicateOfId ? 'exact' : 'fuzzy',
      })),
    };
  }

  createOverrideRequest(
    certificateId: string,
    reason: string,
    requestedBy: string,
  ): OverrideRequest {
    const request: OverrideRequest = {
      id: `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      certificateId,
      reason,
      requestedBy,
      status: 'pending',
      createdAt: new Date(),
    };

    // In a real implementation, you would save this to a database
    this.logger.log(
      `Override request created for certificate ${certificateId}`,
    );

    return request;
  }

  approveOverrideRequest(
    requestId: string,
    approvedBy: string,
  ): OverrideRequest {
    // In a real implementation, you would update the request in the database
    this.logger.log(`Override request ${requestId} approved by ${approvedBy}`);

    return {
      id: requestId,
      certificateId: '',
      reason: '',
      requestedBy: '',
      approvedBy,
      status: 'approved',
      createdAt: new Date(),
      reviewedAt: new Date(),
    };
  }
}
