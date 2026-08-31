import { Injectable } from '@nestjs/common';

@Injectable()
export class MetadataSchemaService {
  private schemas = [
    { name: 'user', fields: [] },
    { name: 'product', fields: [] },
  ];

  findByName(name: string) {
    return this.schemas.find((schema) => schema.name === name);
  }
}
