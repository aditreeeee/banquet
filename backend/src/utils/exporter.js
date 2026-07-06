/**
 * Report Exporter — renders tabular report data as CSV, Excel (.xlsx), or PDF.
 * Shared by every report endpoint that supports ?format=csv|xlsx|pdf.
 */

'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * @param {Array<{key:string, label:string}>} columns
 * @param {Array<object>} rows
 */
const toCSV = (columns, rows) => {
    const escape = (val) => {
        if (val == null) return '';
        const str = String(val);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = columns.map(c => escape(c.label)).join(',');
    const lines = rows.map(row => columns.map(c => escape(row[c.key])).join(','));
    return [header, ...lines].join('\r\n');
};

/**
 * @returns {Promise<Buffer>}
 */
const toExcel = async (columns, rows, sheetName = 'Report') => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns.map(c => ({ header: c.label, key: c.key, width: Math.max(c.label.length + 2, 14) }));
    sheet.getRow(1).font = { bold: true };
    rows.forEach(row => sheet.addRow(row));
    return workbook.xlsx.writeBuffer();
};

/**
 * @returns {Promise<Buffer>}
 */
const toPDF = (title, columns, rows) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(16).text(title, { align: 'left' });
        doc.moveDown(0.5);
        doc.fontSize(9).fillColor('#666').text(`Generated ${new Date().toLocaleString('en-IN')}`, { align: 'left' });
        doc.moveDown(1);

        const startX = doc.x;
        const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const colWidth = usableWidth / columns.length;
        const rowHeight = 20;

        const drawRow = (values, y, bold) => {
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#111');
            values.forEach((val, i) => {
                doc.text(String(val ?? ''), startX + i * colWidth, y, { width: colWidth - 6, ellipsis: true });
            });
        };

        let y = doc.y;
        drawRow(columns.map(c => c.label), y, true);
        y += rowHeight;
        doc.moveTo(startX, y - 4).lineTo(startX + usableWidth, y - 4).strokeColor('#ccc').stroke();

        rows.forEach((row) => {
            if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
                doc.addPage({ margin: 36, size: 'A4', layout: 'landscape' });
                y = doc.y;
            }
            drawRow(columns.map(c => row[c.key]), y, false);
            y += rowHeight;
        });

        doc.end();
    });
};

/**
 * Sends `rows` in the requested format, or returns false if format is not
 * recognized (caller should fall back to a normal JSON response).
 */
const sendExport = async (res, format, { title, columns, rows, filename }) => {
    if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.send(toCSV(columns, rows));
    }
    if (format === 'xlsx' || format === 'excel') {
        const buffer = await toExcel(columns, rows, title);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        return res.send(buffer);
    }
    if (format === 'pdf') {
        const buffer = await toPDF(title, columns, rows);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
        return res.send(buffer);
    }
    return false;
};

module.exports = { toCSV, toExcel, toPDF, sendExport };
