import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface TemplateVersion {
  name: string;
  version: number;
  createdAt: Date;
  content: string;
}

/**
 * Manages versioned email templates.
 *
 * Template files follow the convention:
 *   templates/<name>.v<version>.hbs
 *
 * Example:
 *   verification-email.v1.hbs  (original)
 *   verification-email.v2.hbs  (updated copy)
 *
 * The service resolves the highest available version by default, enabling
 * safe rollback by simply decrementing the version in configuration.
 */
@Injectable()
export class TemplateVersionService {
  private readonly logger = new Logger(TemplateVersionService.name);
  private readonly templatesDir: string;

  constructor() {
    this.templatesDir = path.join(__dirname, 'templates');
  }

  /**
   * Returns the content of the latest version of `templateName`,
   * or a specific `version` if supplied.
   */
  getTemplate(templateName: string, version?: number): TemplateVersion {
    const available = this.listVersions(templateName);

    if (available.length === 0) {
      throw new NotFoundException(
        `No versioned template files found for "${templateName}".`,
      );
    }

    const target = version
      ? available.find((v) => v.version === version)
      : available[available.length - 1]; // highest version

    if (!target) {
      throw new NotFoundException(
        `Template "${templateName}" version ${version} not found.`,
      );
    }

    return target;
  }

  /**
   * Lists all available versions for a template, sorted ascending.
   */
  listVersions(templateName: string): TemplateVersion[] {
    const pattern = new RegExp(String.raw`^${templateName}\.v(\d+)\.hbs$`);
    let files: string[] = [];

    try {
      files = fs.readdirSync(this.templatesDir);
    } catch {
      this.logger.warn(`Templates directory not found: ${this.templatesDir}`);
      return [];
    }

    return files
      .map((file) => {
        const match = pattern.exec(file);
        if (!match) return null;
        const version = parseInt(match[1], 10);
        const filePath = path.join(this.templatesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const { birthtime } = fs.statSync(filePath);
        return {
          name: templateName,
          version,
          createdAt: birthtime,
          content,
        } satisfies TemplateVersion;
      })
      .filter((v): v is TemplateVersion => v !== null)
      .sort((a, b) => a.version - b.version);
  }
}
