/**
 * Quotation PDF — document-style layout (letterhead, line items, totals),
 * distinct from exporter.js's toPDF (which renders tabular report data).
 * Reuses the same pdfkit streaming-to-Buffer pattern.
 */
'use strict';

const PDFDocument = require('pdfkit');

/**
 * @param {object} quotation - row from quotation.repository.js findById
 * @param {Array} items - rows from quotation.repository.js getItems
 * @param {object} company - { company_name, address, phone, email } (best-effort; fields may be blank)
 * @returns {Promise<Buffer>}
 */
const generateQuotationPDF = (quotation, items, company = {}) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 48, size: 'A4' });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const fmt = (n) => `Rs. ${(parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Letterhead
        doc.fontSize(20).font('Helvetica-Bold').text(company.company_name || 'BanquetPro', { align: 'left' });
        doc.fontSize(9).font('Helvetica').fillColor('#555')
            .text([company.address, company.phone, company.email].filter(Boolean).join(' · '));
        doc.moveDown(1.2);

        doc.fontSize(16).font('Helvetica-Bold').fillColor('#111').text('QUOTATION');
        doc.fontSize(10).font('Helvetica').fillColor('#333');
        doc.text(`Quotation #: ${quotation.quotation_number}  (Revision ${quotation.revision})`);
        doc.text(`Date: ${new Date(quotation.created_at).toLocaleDateString('en-IN')}`);
        if (quotation.expiry_date) doc.text(`Valid until: ${new Date(quotation.expiry_date).toLocaleDateString('en-IN')}`);
        doc.moveDown(0.8);

        doc.font('Helvetica-Bold').text('Prepared for:');
        doc.font('Helvetica').text(quotation.contact_name || '—');
        if (quotation.contact_phone) doc.text(quotation.contact_phone);
        if (quotation.contact_email) doc.text(quotation.contact_email);
        doc.moveDown(0.8);

        if (quotation.event_name || quotation.event_date || quotation.hall_name) {
            doc.font('Helvetica-Bold').text('Event Details:');
            doc.font('Helvetica').text([
                quotation.event_name, quotation.event_type,
                quotation.event_date ? new Date(quotation.event_date).toLocaleDateString('en-IN') : null,
                quotation.hall_name, quotation.guest_count ? `${quotation.guest_count} guests` : null,
            ].filter(Boolean).join(' · '));
            doc.moveDown(0.8);
        }

        // Line items table
        doc.moveDown(0.4);
        const startX = doc.x;
        const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const cols = [
            { label: 'Description', width: usableWidth * 0.4 },
            { label: 'Qty',         width: usableWidth * 0.12 },
            { label: 'Unit Price',  width: usableWidth * 0.16 },
            { label: 'Tax %',       width: usableWidth * 0.12 },
            { label: 'Total',       width: usableWidth * 0.2 },
        ];
        let y = doc.y;
        let x = startX;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111');
        cols.forEach(c => { doc.text(c.label, x, y, { width: c.width }); x += c.width; });
        y += 16;
        doc.moveTo(startX, y - 3).lineTo(startX + usableWidth, y - 3).strokeColor('#ccc').stroke();

        doc.font('Helvetica').fontSize(9);
        (items || []).forEach(item => {
            if (y > doc.page.height - doc.page.margins.bottom - 100) { doc.addPage(); y = doc.y; }
            x = startX;
            const values = [item.description, String(item.quantity), fmt(item.unit_price), `${item.tax_percent}%`, fmt(item.line_total)];
            values.forEach((v, i) => { doc.text(v, x, y, { width: cols[i].width, ellipsis: true }); x += cols[i].width; });
            y += 16;
        });

        y += 8;
        doc.moveTo(startX, y).lineTo(startX + usableWidth, y).strokeColor('#ccc').stroke();
        y += 10;

        const totalsX = startX + usableWidth * 0.6;
        const totalsWidth = usableWidth * 0.4;
        const drawTotal = (label, value, bold) => {
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5);
            doc.text(label, totalsX, y, { width: totalsWidth * 0.55, align: 'left' });
            doc.text(value, totalsX + totalsWidth * 0.55, y, { width: totalsWidth * 0.45, align: 'right' });
            y += bold ? 20 : 16;
        };
        drawTotal('Subtotal', fmt(quotation.subtotal));
        if (quotation.discount_amount > 0) drawTotal('Discount', `-${fmt(quotation.discount_amount)}`);
        drawTotal('Tax', fmt(quotation.tax_amount));
        drawTotal('Grand Total', fmt(quotation.grand_total), true);

        if (quotation.notes) {
            doc.moveDown(1.5);
            doc.font('Helvetica-Bold').fontSize(9).text('Notes:');
            doc.font('Helvetica').fontSize(9).fillColor('#333').text(quotation.notes, { width: usableWidth });
        }

        doc.fontSize(8).fillColor('#999').text(
            `This quotation is generated electronically and is valid until the date specified above.`,
            doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 20,
            { width: usableWidth, align: 'center' }
        );

        doc.end();
    });
};

module.exports = { generateQuotationPDF };
