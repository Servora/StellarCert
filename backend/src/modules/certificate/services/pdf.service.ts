import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Certificate } from '../entities/certificate.entity';

@Injectable()
export class CertificatePdfService {
  generate(certificate: Certificate): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc
        .fontSize(26)
        .font('Helvetica-Bold')
        .text('Certificate of Achievement', { align: 'center' });
      doc.moveDown();
      doc
        .fontSize(13)
        .font('Helvetica')
        .text('This certifies that', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(certificate.recipientName, { align: 'center' });
      doc.moveDown();
      doc
        .fontSize(13)
        .font('Helvetica')
        .text(certificate.title, { align: 'center' });

      if (certificate.courseName) {
        doc
          .fontSize(12)
          .text(`Course: ${certificate.courseName}`, { align: 'center' });
      }

      doc.moveDown();
      doc.fontSize(11).text(`Certificate ID: ${certificate.certificateId}`, {
        align: 'center',
      });
      doc
        .fontSize(11)
        .text(`Issued by: ${certificate.issuerName ?? 'Unknown'}`, {
          align: 'center',
        });
      doc
        .fontSize(11)
        .text(
          `Issued on: ${new Date(certificate.issuedAt).toLocaleDateString()}`,
          { align: 'center' },
        );

      if (certificate.expiresAt) {
        doc
          .fontSize(11)
          .text(
            `Expires: ${new Date(certificate.expiresAt).toLocaleDateString()}`,
            { align: 'center' },
          );
      }

      doc.end();
    });
  }
}
