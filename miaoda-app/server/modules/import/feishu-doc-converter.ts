import { Logger } from '@nestjs/common';

const logger = new Logger('FeishuDocConverter');

export interface TextElement {
  text_run?: { content?: string; text_element_style?: Record<string, unknown> };
  mention_doc?: { title?: string; url?: string };
  equation?: { content?: string };
}

export interface BlockData {
  block_id?: string;
  block_type?: number;
  parent_id?: string;
  children?: string[];
  page?: { elements?: TextElement[] };
  text?: { elements?: TextElement[] };
  heading1?: { elements?: TextElement[] };
  heading2?: { elements?: TextElement[] };
  heading3?: { elements?: TextElement[] };
  heading4?: { elements?: TextElement[] };
  heading5?: { elements?: TextElement[] };
  heading6?: { elements?: TextElement[] };
  heading7?: { elements?: TextElement[] };
  heading8?: { elements?: TextElement[] };
  heading9?: { elements?: TextElement[] };
  bullet?: { elements?: TextElement[] };
  ordered?: { elements?: TextElement[] };
  code?: { elements?: TextElement[] };
  quote?: { elements?: TextElement[] };
  todo?: { elements?: TextElement[]; style?: { done?: boolean } };
  divider?: Record<string, unknown>;
  image?: { token?: string; width?: number; height?: number; align?: number };
  table?: { cells?: string[]; row_size?: number; column_size?: number };
  table_cell?: Record<string, unknown>;
  bitable?: { token?: string; view_type?: string };
  file?: { token?: string; name?: string };
  file_view?: { token?: string; name?: string; title?: string };
  view?: { token?: string; name?: string; title?: string };
  drive?: { token?: string; name?: string; title?: string };
  callout?: { emoji_id?: string; background_color?: number; border_color?: number };
}

export interface ConvertOptions {
  skipResources?: boolean;
}

export interface ConvertStats {
  images: number;
  tables: number;
  bitables: number;
  attachments: number;
  skippedBlocks: number;
}

export interface AttachmentInfo {
  token: string;
  name: string;
  ext: string;
  source: 'media' | 'drive';
}

export interface BitableInfo {
  appToken: string;
  tableId?: string;
  rawToken: string;
  placeholderKey: string;
}

export interface ConvertResult {
  markdown: string;
  imageTokens: string[];
  attachmentTokens: AttachmentInfo[];
  bitableTokens: string[];
  bitableInfos: BitableInfo[];
  stats: ConvertStats;
}

export function decodeExternalLink(url: string): string {
  const original = (url ?? '').trim();
  if (!original) return original;
  if (/^https?:\/\//i.test(original)) return original;
  let decoded = original;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return /^https?:\/\//i.test(decoded) ? decoded : original;
}

function extractText(elements?: TextElement[]): string {
  if (!elements) return '';
  return elements
    .map((el) => {
      if (el.text_run?.content) {
        let text = el.text_run.content;
        const style = el.text_run.text_element_style;
        if (style) {
          const wrapStyle = (raw: string, marker: string): string => {
            const leading = raw.match(/^\s*/)?.[0] ?? '';
            const trailing = raw.match(/\s*$/)?.[0] ?? '';
            const trimmed = raw.slice(leading.length, raw.length - trailing.length);
            if (!trimmed) return raw;
            return `${leading}${marker}${trimmed}${marker}${trailing}`;
          };
          if (style.bold) text = wrapStyle(text, '**');
          if (style.italic) text = wrapStyle(text, '*');
          if (style.strikethrough) text = wrapStyle(text, '~~');
          if (style.inline_code) text = wrapStyle(text, '`');
          if (style.link) {
            const url = decodeExternalLink((style.link as Record<string, string>).url ?? '');
            text = `[${text}](${url})`;
          }
        }
        return text;
      }
      if (el.mention_doc) {
        return `[${el.mention_doc.title ?? '文档链接'}](${decodeExternalLink(el.mention_doc.url ?? '')})`;
      }
      if (el.equation?.content) {
        return `$${el.equation.content}$`;
      }
      return '';
    })
    .join('');
}

function getHeadingData(
  block: BlockData,
  level: number,
): string {
  const key = `heading${level}` as keyof BlockData;
  const heading = block[key] as { elements?: TextElement[] } | undefined;
  const prefix = '#'.repeat(level);
  return `${prefix} ${extractText(heading?.elements)}`;
}

function buildMarkdownTable(
  tableData: NonNullable<BlockData['table']>,
  cellBlockMap: Map<string, BlockData>,
  blocks: Record<string, unknown>[],
): string {
  const rowSize = tableData.row_size ?? 0;
  const colSize = tableData.column_size ?? 0;
  const cells = tableData.cells ?? [];

  if (rowSize === 0 || colSize === 0 || cells.length === 0) {
    return '> [表格: 无法解析表格结构，请手动处理]';
  }

  const rows: string[][] = [];
  for (let r = 0; r < rowSize; r++) {
    const row: string[] = [];
    for (let c = 0; c < colSize; c++) {
      const cellBlockId = cells[r * colSize + c];
      if (!cellBlockId) {
        row.push('');
        continue;
      }

      const cellBlock = cellBlockMap.get(cellBlockId);
      const cellChildren = cellBlock?.children ?? [];
      const cellTexts: string[] = [];

      for (const childId of cellChildren) {
        const childBlock = cellBlockMap.get(childId) ??
          (blocks.find((b) => (b as BlockData).block_id === childId) as BlockData | undefined);
        if (!childBlock) {
          cellTexts.push('');
          continue;
        }
        const bt = childBlock.block_type ?? 0;
        if (bt === 2) {
          cellTexts.push(extractText(childBlock.text?.elements));
        } else if (bt >= 3 && bt <= 11) {
          cellTexts.push(extractText(
            (childBlock[`heading${bt - 2}` as keyof BlockData] as { elements?: TextElement[] } | undefined)?.elements,
          ));
        } else if (bt === 12) {
          cellTexts.push(extractText(childBlock.bullet?.elements));
        } else if (bt === 13) {
          cellTexts.push(extractText(childBlock.ordered?.elements));
        } else if (bt === 17) {
          const done = childBlock.todo?.style?.done ?? false;
          cellTexts.push(`${done ? '[x]' : '[ ]'} ${extractText(childBlock.todo?.elements)}`);
        } else {
          const textEl = extractText(childBlock.text?.elements);
          if (textEl) cellTexts.push(textEl);
        }
      }

      const cellText = cellTexts.join('<br/>').replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
      row.push(cellText);
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    return '> [表格: 空表格]';
  }

  const lines: string[] = [];
  if (rows.length > 0) {
    lines.push(`| ${rows[0].join(' | ')} |`);
    lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
  }
  for (let i = 1; i < rows.length; i++) {
    lines.push(`| ${rows[i].join(' | ')} |`);
  }
  return lines.join('\n');
}

export function convertBlocksToMarkdown(
  blocks: Record<string, unknown>[],
  cellBlockMap?: Map<string, BlockData>,
  options?: ConvertOptions,
): ConvertResult {
  if (!blocks || blocks.length === 0) {
    return { markdown: '', imageTokens: [], attachmentTokens: [], bitableTokens: [], bitableInfos: [], stats: { images: 0, tables: 0, bitables: 0, attachments: 0, skippedBlocks: 0 } };
  }

  const blockMap = new Map<string, BlockData>();
  for (const block of blocks) {
    const data = block as BlockData;
    if (data.block_id) {
      blockMap.set(data.block_id, data);
    }
  }

  const lines: string[] = [];
  const imageTokens: string[] = [];
  const attachmentTokens: AttachmentInfo[] = [];
  const bitableTokens: string[] = [];
  const bitableInfos: BitableInfo[] = [];
  const stats: ConvertStats = { images: 0, tables: 0, bitables: 0, attachments: 0, skippedBlocks: 0 };
  let orderedCounter = 0;
  const skipResources = options?.skipResources ?? false;
  const resolvedCellMap = cellBlockMap ?? blockMap;

  for (const block of blocks) {
    const data = block as BlockData;
    const blockType = data.block_type ?? 0;

    switch (blockType) {
      case 1:
        break;
      case 2:
        orderedCounter = 0;
        lines.push(extractText(data.text?.elements));
        lines.push('');
        break;
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
      case 8:
      case 9:
      case 10:
      case 11: {
        orderedCounter = 0;
        const level = blockType - 2;
        lines.push(getHeadingData(data, level));
        lines.push('');
        break;
      }
      case 12:
        orderedCounter = 0;
        lines.push(`- ${extractText(data.bullet?.elements)}`);
        break;
      case 13: {
        orderedCounter++;
        lines.push(
          `${orderedCounter}. ${extractText(data.ordered?.elements)}`,
        );
        break;
      }
      case 14:
        orderedCounter = 0;
        lines.push('```');
        lines.push(extractText(data.code?.elements));
        lines.push('```');
        lines.push('');
        break;
      case 15:
        orderedCounter = 0;
        lines.push(`> ${extractText(data.quote?.elements)}`);
        lines.push('');
        break;
      case 17: {
        orderedCounter = 0;
        const done = data.todo?.style?.done ?? false;
        const checkbox = done ? '[x]' : '[ ]';
        lines.push(`- ${checkbox} ${extractText(data.todo?.elements)}`);
        break;
      }
      case 19:
        orderedCounter = 0;
        if (data.children && data.children.length > 0) {
          const calloutTexts: string[] = [];
          for (const childId of data.children) {
            const child = blockMap.get(childId);
            if (child?.text?.elements) {
              calloutTexts.push(extractText(child.text.elements));
            }
          }
          if (calloutTexts.length > 0) {
            lines.push(`> ${calloutTexts.join('')}`);
          } else {
            lines.push(`> `);
          }
        } else {
          lines.push(`> `);
        }
        lines.push('');
        break;
      case 18: {
        orderedCounter = 0;
        const bitableRawToken = data.bitable?.token ?? '';
        if (bitableRawToken) {
          stats.bitables++;
          const underscoreIdx = bitableRawToken.lastIndexOf('_');
          let appToken: string;
          let tableId: string | undefined;
          if (underscoreIdx > 0 && underscoreIdx < bitableRawToken.length - 1) {
            appToken = bitableRawToken.slice(0, underscoreIdx);
            tableId = bitableRawToken.slice(underscoreIdx + 1);
          } else {
            appToken = bitableRawToken;
          }
          const placeholderKey = tableId ? `${appToken}_${tableId}` : appToken;
          bitableTokens.push(appToken);
          bitableInfos.push({ appToken, tableId, rawToken: bitableRawToken, placeholderKey });
          lines.push('');
          lines.push(`[bitable_token_${placeholderKey}]`);
          lines.push('');
          logger.log(
            `Bitable block: blockId=${(data.block_id ?? '').slice(0, 12)}... ` +
            `rawToken=${bitableRawToken.slice(0, 8)}...${bitableRawToken.slice(-6)} ` +
            `appToken=${appToken.slice(0, 8)}...${appToken.slice(-4)} ` +
            `tableId=${tableId ?? 'N/A'} viewType=${data.bitable?.view_type ?? 'N/A'}`,
          );
        } else if (data.children && data.children.length > 0) {
          for (const colId of data.children) {
            const colBlock = blockMap.get(colId);
            if (colBlock?.children) {
              for (const innerId of colBlock.children) {
                const inner = blockMap.get(innerId);
                if (!inner) continue;
                const ibt = inner.block_type ?? 0;
                if (ibt === 2 && inner.text?.elements) {
                  lines.push(extractText(inner.text.elements));
                  lines.push('');
                } else if (ibt >= 3 && ibt <= 11) {
                  lines.push(getHeadingData(inner, ibt - 2));
                  lines.push('');
                } else if (ibt === 12 && inner.bullet?.elements) {
                  lines.push(`- ${extractText(inner.bullet.elements)}`);
                } else if (ibt === 13 && inner.ordered?.elements) {
                  lines.push(`1. ${extractText(inner.ordered.elements)}`);
                } else if (ibt === 27) {
                  const imgToken = inner.image?.token ?? '';
                  stats.images++;
                  if (skipResources) {
                    lines.push(`[图片: 预览模式]`);
                  } else if (imgToken) {
                    imageTokens.push(imgToken);
                    lines.push(`![图片](img_token_${imgToken})`);
                  } else {
                    lines.push(`[图片下载失败: 未获取到图片信息]`);
                  }
                  lines.push('');
                }
              }
            }
          }
        }
        break;
      }
      case 22:
        orderedCounter = 0;
        lines.push('---');
        lines.push('');
        break;
      case 20:
      case 23:
      case 24: {
        orderedCounter = 0;
        const fileInfo = data.file ?? data.file_view ?? data.view ?? data.drive;
        const cardToken = fileInfo?.token ?? '';
        const cardName = fileInfo?.name ?? (fileInfo as Record<string, unknown>)?.title as string ?? '附件';
        const cardExt = cardName.includes('.') ? cardName.slice(cardName.lastIndexOf('.')).toLowerCase() : '';
        stats.attachments++;
        if (skipResources) {
          lines.push(`[附件: ${cardName} (预览模式)]`);
        } else if (cardToken) {
          attachmentTokens.push({ token: cardToken, name: cardName, ext: cardExt, source: 'media' });
          lines.push(`[${cardName}](att_token_${cardToken})`);
        } else {
          lines.push(`[附件: ${cardName} — 无法提取下载链接，请在飞书中以"附件"方式插入]`);
        }
        lines.push('');
        break;
      }
      case 26: {
        orderedCounter = 0;
        const fileToken = data.file?.token ?? '';
        const fileName = data.file?.name ?? '附件';
        const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
        stats.attachments++;
        if (skipResources) {
          lines.push(`[附件: ${fileName} (预览模式)]`);
        } else if (fileToken) {
          attachmentTokens.push({ token: fileToken, name: fileName, ext, source: 'media' });
          lines.push(`[${fileName}](att_token_${fileToken})`);
        } else {
          lines.push(`[附件下载失败: 未获取到附件信息]`);
        }
        lines.push('');
        break;
      }
      case 27: {
        orderedCounter = 0;
        const token = data.image?.token ?? '';
        stats.images++;
        if (skipResources) {
          lines.push(`[图片: 预览模式]`);
        } else if (token) {
          imageTokens.push(token);
          lines.push(`![图片](img_token_${token})`);
        } else {
          lines.push(`[图片下载失败: 未获取到图片信息]`);
        }
        lines.push('');
        break;
      }
      case 31: {
        orderedCounter = 0;
        stats.tables++;
        const tableData = data.table;
        if (tableData && tableData.cells && tableData.cells.length > 0) {
          const tableMd = buildMarkdownTable(tableData, resolvedCellMap, blocks);
          lines.push('');
          lines.push(tableMd);
          lines.push('');
        } else {
          lines.push('');
          lines.push('> [表格: 无法解析表格结构，请手动处理]');
          lines.push('');
        }
        break;
      }
      case 32:
        break;
      default:
        orderedCounter = 0;
        if (blockType >= 18 && blockType <= 48 && blockType !== 20 && blockType !== 23 && blockType !== 24 && blockType !== 26 && blockType !== 27 && blockType !== 31 && blockType !== 32) {
          stats.skippedBlocks++;
          logger.log(`跳过不支持的 Block 类型: ${blockType}`);
        }
        break;
    }
  }

  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown, imageTokens, attachmentTokens, bitableTokens, bitableInfos, stats };
}

export function encodeAttachmentUrl(url: string): string {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep original */ }
  return decoded.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

export function replaceTokenPaths(
  markdown: string,
  imagePathMap: Map<string, string>,
  attachmentPathMap: Map<string, string>,
): string {
  let result = markdown;
  for (const [token, localPath] of imagePathMap) {
    const placeholder = `img_token_${token}`;
    result = result.replaceAll(placeholder, localPath);
  }
  for (const [token, localPath] of attachmentPathMap) {
    const placeholder = `att_token_${token}`;
    result = result.replaceAll(placeholder, encodeAttachmentUrl(localPath));
  }
  return result;
}

export function generateFrontmatter(
  title: string,
  sidebarPosition: number,
  summary?: string,
): string {
  const lines = ['---'];
  lines.push(`title: ${title}`);
  lines.push(`sidebar_label: ${title}`);
  if (summary) {
    lines.push(`description: ${summary}`);
  }
  lines.push(`sidebar_position: ${sidebarPosition}`);
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}
