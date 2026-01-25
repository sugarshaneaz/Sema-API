import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import pdfParse from "pdf-parse";
import Tesseract from "tesseract.js";

const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 70;
const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20MB

export interface ProcessedFile {
  buffer: Buffer;
  originalSize: number;
  compressedSize: number;
  extractedText: string;
  contentType: string;
}

export async function processImage(buffer: Buffer): Promise<ProcessedFile> {
  const originalSize = buffer.length;
  
  const metadata = await sharp(buffer).metadata();
  
  let processedBuffer: Buffer;
  if (metadata.width && metadata.width > MAX_IMAGE_WIDTH) {
    processedBuffer = await sharp(buffer)
      .resize(MAX_IMAGE_WIDTH, null, { withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } else {
    processedBuffer = await sharp(buffer)
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  }
  
  let extractedText = "";
  try {
    const result = await Tesseract.recognize(buffer, "eng+swa+amh", {
      logger: () => {},
    });
    extractedText = result.data.text.trim();
  } catch (error) {
    console.error("OCR failed:", error);
  }
  
  return {
    buffer: processedBuffer,
    originalSize,
    compressedSize: processedBuffer.length,
    extractedText,
    contentType: "image/jpeg",
  };
}

export async function processPdf(buffer: Buffer): Promise<ProcessedFile> {
  const originalSize = buffer.length;
  
  if (originalSize > MAX_PDF_SIZE) {
    throw new Error(`PDF exceeds maximum size of ${MAX_PDF_SIZE / 1024 / 1024}MB`);
  }
  
  let extractedText = "";
  try {
    const pdfData = await pdfParse(buffer);
    extractedText = pdfData.text.trim();
  } catch (error) {
    console.error("PDF text extraction failed:", error);
  }
  
  let compressedBuffer = buffer;
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    
    pdfDoc.setTitle("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer("");
    pdfDoc.setCreator("");
    
    compressedBuffer = Buffer.from(await pdfDoc.save({
      useObjectStreams: true,
    }));
  } catch (error) {
    console.error("PDF compression failed, using original:", error);
  }
  
  if (!extractedText && buffer.length > 0) {
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      
      if (pages.length > 0) {
        const firstPage = pages[0];
        const { width, height } = firstPage.getSize();
        
        const pngBuffer = await sharp({
          create: {
            width: Math.min(Math.round(width * 2), 2000),
            height: Math.min(Math.round(height * 2), 2000),
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }
        }).png().toBuffer();
        
        const result = await Tesseract.recognize(pngBuffer, "eng+swa+amh", {
          logger: () => {},
        });
        extractedText = result.data.text.trim();
      }
    } catch (ocrError) {
      console.error("PDF OCR failed:", ocrError);
    }
  }
  
  return {
    buffer: compressedBuffer,
    originalSize,
    compressedSize: compressedBuffer.length,
    extractedText,
    contentType: "application/pdf",
  };
}

export async function processFile(
  buffer: Buffer,
  mimeType: string,
  fileType: "pdf" | "image"
): Promise<ProcessedFile> {
  if (fileType === "image" || mimeType.startsWith("image/")) {
    return processImage(buffer);
  } else if (fileType === "pdf" || mimeType === "application/pdf") {
    return processPdf(buffer);
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
}

export function isValidFileType(mimeType: string, fileType: "pdf" | "image"): boolean {
  if (fileType === "image") {
    return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
  } else if (fileType === "pdf") {
    return mimeType === "application/pdf";
  }
  return false;
}
