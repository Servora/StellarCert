import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditResourceType } from '../constants';

export interface AuditDecoratorOptions {
  action: AuditAction;
  resourceType: AuditResourceType;
  captureChanges?: boolean;
  captureResult?: boolean;
  description?: string;
}

export const AUDIT_METADATA_KEY = 'audit_metadata';

export function Audit(options: AuditDecoratorOptions) {
  return SetMetadata(AUDIT_METADATA_KEY, options);
}
