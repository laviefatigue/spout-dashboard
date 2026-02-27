import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

interface ExportOptions {
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
}

function addHeader(pdf: jsPDF, title: string, subtitle: string | undefined, margin: number, pageWidth: number) {
  // Indigo accent bar
  pdf.setFillColor(79, 70, 229);
  pdf.rect(margin, margin, pageWidth - margin * 2, 1, 'F');

  pdf.setFontSize(18);
  pdf.setTextColor(79, 70, 229);
  pdf.text(title, margin, margin + 8);

  if (subtitle) {
    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128);
    pdf.text(subtitle, margin, margin + 14);
  }

  // Date on right
  pdf.setFontSize(9);
  pdf.setTextColor(107, 114, 128);
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  pdf.text(dateStr, pageWidth - margin, margin + 8, { align: 'right' });
}

function addFooter(pdf: jsPDF, page: number, totalPages: number, margin: number, pageWidth: number, pageHeight: number) {
  // Accent line
  pdf.setDrawColor(79, 70, 229);
  pdf.setLineWidth(0.3);
  pdf.line(margin, pageHeight - margin - 2, pageWidth - margin, pageHeight - margin - 2);

  pdf.setFontSize(7);
  pdf.setTextColor(156, 163, 175);
  pdf.text(
    'Selery Fulfillment  |  Outbound Analytics Report',
    margin,
    pageHeight - margin + 1
  );
  pdf.text(
    `Page ${page + 1} of ${totalPages}`,
    pageWidth - margin,
    pageHeight - margin + 1,
    { align: 'right' }
  );
}

export async function exportPageToPDF(
  element: HTMLElement,
  filename: string,
  options: ExportOptions = {}
) {
  const { title, subtitle, orientation = 'landscape' } = options;

  // Temporarily mark body as exporting so CSS can hide interactive elements
  document.body.classList.add('exporting-pdf');

  // Force light mode during export
  const htmlEl = document.documentElement;
  const wasDark = htmlEl.classList.contains('dark');
  if (wasDark) htmlEl.classList.remove('dark');

  // Wait for reflows
  await new Promise((r) => setTimeout(r, 300));

  const canvas = await html2canvas(element, {
    scale: 3,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  document.body.classList.remove('exporting-pdf');
  if (wasDark) htmlEl.classList.add('dark');

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;
  const headerHeight = title ? 24 : 0;
  const footerHeight = 12;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;

  // Calculate image dimensions to fit page width
  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const totalPages = Math.ceil(imgHeight / contentHeight);

  // Always use the canvas-slicing approach for clean multi-page output
  const sliceHeightPx = (contentHeight / imgWidth) * canvas.width;

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage();

    // Header
    if (title) {
      addHeader(pdf, title, subtitle, margin, pageWidth);
    }

    // Create a canvas slice for this page
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    const thisSliceHeight = Math.min(
      sliceHeightPx,
      canvas.height - page * sliceHeightPx
    );
    sliceCanvas.height = thisSliceHeight;
    const ctx = sliceCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        page * sliceHeightPx,
        canvas.width,
        thisSliceHeight,
        0,
        0,
        canvas.width,
        thisSliceHeight
      );
    }

    const sliceData = sliceCanvas.toDataURL('image/png');
    const sliceImgHeight = (thisSliceHeight * imgWidth) / canvas.width;
    pdf.addImage(
      sliceData,
      'PNG',
      margin,
      margin + headerHeight,
      imgWidth,
      sliceImgHeight,
      undefined,
      'FAST'
    );

    // Footer
    addFooter(pdf, page, totalPages, margin, pageWidth, pageHeight);
  }

  pdf.save(filename);
}
