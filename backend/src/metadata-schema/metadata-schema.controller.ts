import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { MetadataSchemaService } from './metadata-schema.service';

@Controller('metadata-schema')
export class MetadataSchemaController {
  constructor(private readonly metadataSchemaService: MetadataSchemaService) {}

  @Get(':name')
  getSchemaByName(@Param('name') name: string) {
    const schema = this.metadataSchemaService.findByName(name);

    // ✅ FIX: Proper HTTP exception instead of raw Error
    if (!schema) {
      throw new NotFoundException(`No schema found with name "${name}"`);
    }

    return schema;
  }
}
