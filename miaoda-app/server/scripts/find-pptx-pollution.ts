/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-console */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { docs } from '../database/schema.js';
import { like, or, and } from 'drizzle-orm';

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/odpm';
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log('=== Scanning all documents for PPTX pollution ===\n');

  // 1. 先获取所有文档
  const allDocs = await db.select({
    id: docs.id,
    title: docs.title,
    slug: docs.slug,
    markdownContent: docs.markdownContent,
  }).from(docs);

  console.log(`Total documents in database: ${allDocs.length}\n`);

  const pollutedDocs: any[] = [];
  const pptxRefDocs: any[] = [];

  for (const doc of allDocs) {
    const content = doc.markdownContent || '';
    const patterns: string[] = [];

    // 检测 PPTX 污染标记
    if (content.includes('幻灯片内容摘要')) patterns.push('幻灯片内容摘要');
    if (content.includes('点击下载')) patterns.push('点击下载');
    if (content.includes('缩略图') && content.includes('ppt-')) patterns.push('缩略图(带ppt-路径)');
    if (content.includes('<details>') && content.includes('<summary>')) patterns.push('<details>+<summary>幻灯片提取块');

    // 检测 PPTX 文件引用
    const hasPptxRef = content.includes('.pptx') || content.includes('.ppt');
    if (hasPptxRef && !pptxRefDocs.some(d => d.id === doc.id)) {
      pptxRefDocs.push({ id: doc.id, title: doc.title, slug: doc.slug });
    }

    if (patterns.length > 0) {
      pollutedDocs.push({
        id: doc.id,
        title: doc.title,
        slug: doc.slug,
        patterns,
      });
    }
  }

  console.log('=== 1. Documents with PPTX pollution ===');
  console.log(`Total: ${pollutedDocs.length}`);
  for (const d of pollutedDocs) {
    console.log(`- ID: ${d.id}`);
    console.log(`  Title: ${d.title}`);
    console.log(`  Slug: ${d.slug}`);
    console.log(`  Patterns: ${d.patterns.join(', ')}`);
    console.log('');
  }

  console.log('=== 2. Documents with PPTX/PPT file references (including clean ones) ===');
  console.log(`Total: ${pptxRefDocs.length}`);
  for (const d of pptxRefDocs) {
    console.log(`- ID: ${d.id} | Title: ${d.title} | Slug: ${d.slug}`);
  }

  await client.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
