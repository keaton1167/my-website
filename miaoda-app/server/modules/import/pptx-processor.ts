import { Logger } from '@nestjs/common';
import JSZip from 'jszip';

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_SLIDES = 100;
const MAX_TEXT_PER_SLIDE = 2000;
const MAX_IMAGES = 50;

export interface PptxProcessResult {
  slideCount: number;
  slideTexts: string[];
  extractedImages: { fileName: string; buffer: Buffer }[];
  thumbnailBuffer?: Buffer;
  skipped: boolean;
  skipReason?: string;
}

const logger = new Logger('PptxProcessor');

function extractSlideNumber(fileName: string): number {
  const match = fileName.match(/slide(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function extractTextFromXml(xml: string): string {
  const texts: string[] = [];
  const regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    if (match[1]) {
      texts.push(match[1]);
    }
  }
  return texts.join(' ');
}

export async function processPptx(buffer: Buffer): Promise<PptxProcessResult> {
  if (buffer.length > MAX_FILE_SIZE) {
    const reason = `文件过大 (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 30MB)，跳过解析`;
    logger.warn(reason);
    return { slideCount: 0, slideTexts: [], extractedImages: [], skipped: true, skipReason: reason };
  }

  try {
    const zip = await JSZip.loadAsync(buffer);

    const slideFiles: { name: string; num: number }[] = [];
    zip.forEach((relativePath) => {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(relativePath)) {
        slideFiles.push({ name: relativePath, num: extractSlideNumber(relativePath) });
      }
    });
    slideFiles.sort((a, b) => a.num - b.num);

    const slidesToProcess = slideFiles.slice(0, MAX_SLIDES);
    const slideTexts: string[] = [];

    for (const slide of slidesToProcess) {
      const file = zip.file(slide.name);
      if (!file) continue;
      const xml = await file.async('string');
      let text = extractTextFromXml(xml);
      if (text.length > MAX_TEXT_PER_SLIDE) {
        text = text.slice(0, MAX_TEXT_PER_SLIDE) + '...';
      }
      slideTexts.push(text);
    }

    const extractedImages: { fileName: string; buffer: Buffer }[] = [];
    let imageCount = 0;
    const mediaEntries: string[] = [];
    zip.forEach((relativePath) => {
      if (/^ppt\/media\/.+\.(png|jpg|jpeg|gif|svg)$/i.test(relativePath)) {
        mediaEntries.push(relativePath);
      }
    });

    for (const mediaPath of mediaEntries) {
      if (imageCount >= MAX_IMAGES) break;
      const file = zip.file(mediaPath);
      if (!file) continue;
      const imgBuffer = await file.async('nodebuffer');
      const fileName = mediaPath.replace('ppt/media/', '');
      extractedImages.push({ fileName, buffer: imgBuffer });
      imageCount++;
    }

    let thumbnailBuffer: Buffer | undefined;
    const thumbFile = zip.file('docProps/thumbnail.jpeg');
    if (thumbFile) {
      thumbnailBuffer = await thumbFile.async('nodebuffer');
    }

    logger.log(
      `PPTX 解析完成: ${slidesToProcess.length} 页, ${extractedImages.length} 张图片, ` +
      `缩略图=${thumbnailBuffer ? '有' : '无'}`,
    );

    return {
      slideCount: slidesToProcess.length,
      slideTexts,
      extractedImages,
      thumbnailBuffer,
      skipped: false,
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    const reason = `PPTX 解析异常: ${e.message ?? 'unknown'}`;
    logger.warn(reason);
    return { slideCount: 0, slideTexts: [], extractedImages: [], skipped: true, skipReason: reason };
  }
}

export async function pptxToPdf(_buffer: Buffer): Promise<Buffer | null> {
  logger.log('PPT 转 PDF 功能尚未实现，需要 LibreOffice 或外部 API 支持');
  return null;
}

export async function pptxToSlideImages(_buffer: Buffer): Promise<{ slideNumber: number; buffer: Buffer }[] | null> {
  logger.log('PPT 转幻灯片图片功能尚未实现，需要渲染引擎支持');
  return null;
}
