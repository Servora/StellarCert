import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface CertificateData {
    recipientName: string;
    courseName: string;
    date: Date;
    issuerName: string;
    qrCodeBuffer?: Buffer;
    verificationUrl?: string;
    tokenId?: string;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async generateCertificate(data: CertificateData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margin: 50
        });

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfData = Buffer.concat(buffers);
            resolve(pdfData);
        });
        
        // Border
        doc.lineWidth(3);
        doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke();
        
        // Header
        doc.moveDown(2);
        doc.fontSize(36).font('Helvetica-Bold').text('Certificate of Completion', {
            align: 'center'
        });
        doc.moveDown();
        
        // Recipient Text
        doc.fontSize(20).font('Helvetica').text('This is to certify that', {
            align: 'center'
        });
        doc.moveDown();
        
        // Recipient Name
        doc.fontSize(30).font('Helvetica-Bold').text(data.recipientName, {
            align: 'center'
        });
        doc.moveDown();
        
        // Course Text
        doc.fontSize(18).font('Helvetica').text(`Has successfully completed the course`, {
            align: 'center'
        });
        doc.moveDown(0.5);
        
        // Course Name
        doc.fontSize(24).font('Helvetica-Bold').text(data.courseName, {
            align: 'center'
        });
        doc.moveDown(2);
        
        // Date and Issuer
        const yPos = doc.y;
        
        doc.fontSize(16).font('Helvetica').text(`Date: ${new Date(data.date).toLocaleDateString()}`, 60, yPos);
        
        doc.fontSize(16).font('Helvetica-Bold').text(data.issuerName, doc.page.width - 300, yPos, {
            align: 'right'
        });
        doc.fontSize(12).font('Helvetica').text('Issuer', doc.page.width - 300, yPos + 20, {
            align: 'right'
        });
        
        // QR Code
        if (data.qrCodeBuffer) {
            const qrSize = 100;
            const qrX = (doc.page.width - qrSize) / 2;
            const qrY = doc.page.height - 150;
            
            doc.image(data.qrCodeBuffer, qrX, qrY, {
                fit: [qrSize, qrSize]
            });
            
            if (data.verificationUrl) {
                doc.fontSize(10).font('Helvetica').text('Scan to verify', qrX, qrY + qrSize + 5, {
                    align: 'center',
                    width: qrSize
                });
            }
        }
        
        // Token ID
        if (data.tokenId) {
            doc.fontSize(10).font('Helvetica').text(`Token ID: ${data.tokenId}`, 60, doc.page.height - 40);
        }

        doc.end();
      } catch (error) {
        this.logger.error(`Failed to generate PDF: ${error.message}`, error.stack);
        reject(error);
      }
    });
  }
}
