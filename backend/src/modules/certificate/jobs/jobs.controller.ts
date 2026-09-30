import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobsService } from './services/jobs.service';
import { EnqueueEmailDto, EnqueuePdfDto } from './dto/create-job.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../users/guards/roles.guard';
import { Roles } from '../../users/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles';

@ApiTags('Jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('email')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Enqueue an email job' })
  @ApiResponse({ status: 201, description: 'Email job enqueued successfully' })
  async enqueueEmail(@Body() payload: EnqueueEmailDto) {
    return this.jobsService.enqueueEmailJob(payload);
  }

  @Post('pdf')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Enqueue a PDF generation job' })
  @ApiResponse({ status: 201, description: 'PDF job enqueued successfully' })
  async enqueuePdf(@Body() payload: EnqueuePdfDto) {
    return this.jobsService.enqueuePdfJob(payload);
  }
}
