import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CertificatesService } from './certificates.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { StatsQueryDto, CertificateStatsDto } from './dto/stats.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('certificates')
@Controller('certificates')
export class CertificatesController {
    constructor(private readonly certificatesService: CertificatesService) { }

    @Get('stats')
    @Public() // Making stats public for the dashboard
    @ApiOperation({ summary: 'Get certificate statistics' })
    @ApiResponse({ status: 200, type: CertificateStatsDto })
    async getStats(@Query() query: StatsQueryDto) {
        return await this.certificatesService.getStatistics(query);
    }

    @Get('verify/:serial')
    @Public() // Verification should be public
    @ApiOperation({ summary: 'Verify a certificate by ID or transaction hash' })
    async verify(@Param('serial') serial: string) {
        return await this.certificatesService.verify(serial);
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Issue a new certificate' })
    async issue(@Body() createDto: CreateCertificateDto) {
        return await this.certificatesService.issue(createDto);
    }

    @Get()
    @ApiOperation({ summary: 'Get all certificates' })
    async findAll() {
        return await this.certificatesService.findAll();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a certificate by internal ID' })
    async findOne(@Param('id') id: string) {
        return await this.certificatesService.findOne(id);
    }
}
