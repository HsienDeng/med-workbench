/**
 * IMA 媒体类型 → 图标 / 颜色 / 名称映射。
 * 由文件夹树与文件列表共用，避免两处重复维护。
 * 有对应导入 SVG 的类型优先使用 SVG 图标（尺寸 1em，随字号缩放）。
 */
import {
  EditOutlined,
  FileExcelOutlined,
  FileMarkdownOutlined,
  FilePptOutlined,
  FileWordOutlined,
  GlobalOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

import exeSvg from '@/assets/files/exe.svg';
import folderSvg from '@/assets/files/folder.svg';
import imageSvg from '@/assets/files/image.svg';
import musicSvg from '@/assets/files/music.svg';
import pdfSvg from '@/assets/files/pdf.svg';
import txtSvg from '@/assets/files/txt.svg';

export interface MediaMeta {
  icon: ReactNode;
  color: string;
  label: string;
}

/** 以导入的 SVG 作为图标，尺寸跟随字号（1em），行内垂直居中 */
function SvgIcon({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      style={{
        width: '1em',
        height: '1em',
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
      }}
    />
  );
}

/** media_type = 99 为文件夹 */
export const FOLDER_MEDIA_TYPE = 99;

export const MEDIA_META: Record<number, MediaMeta> = {
  1: { icon: <SvgIcon src={pdfSvg} />, color: '#f5222d', label: 'PDF' },
  2: { icon: <GlobalOutlined />, color: '#1677ff', label: '网页' },
  3: { icon: <FileWordOutlined />, color: '#2f54eb', label: 'Word' },
  4: { icon: <FilePptOutlined />, color: '#fa8c16', label: 'PPT' },
  5: { icon: <FileExcelOutlined />, color: '#52c41a', label: 'Excel' },
  6: { icon: <MessageOutlined />, color: '#07c160', label: '公众号' },
  7: { icon: <FileMarkdownOutlined />, color: '#722ed1', label: 'Markdown' },
  9: { icon: <SvgIcon src={imageSvg} />, color: '#eb2f96', label: '图片' },
  11: { icon: <EditOutlined />, color: '#13c2c2', label: '笔记' },
  12: { icon: <MessageOutlined />, color: '#eb2f96', label: 'AI 会话' },
  13: { icon: <SvgIcon src={txtSvg} />, color: '#595959', label: 'TXT' },
  14: { icon: <FileWordOutlined />, color: '#8c8c8c', label: '思维导图' },
  15: { icon: <SvgIcon src={musicSvg} />, color: '#722ed1', label: '录音' },
  20: { icon: <GlobalOutlined />, color: '#1677ff', label: 'HTML' },
  21: { icon: <FileMarkdownOutlined />, color: '#a0d911', label: 'EPUB' },
  [FOLDER_MEDIA_TYPE]: {
    icon: <SvgIcon src={folderSvg} />,
    color: '#f0a020',
    label: '文件夹',
  },
};

/** 未知类型默认文件：IMA 枚举无 exe 类型，以 exe 图标兜底 */
export const MEDIA_META_DEFAULT: MediaMeta = {
  icon: <SvgIcon src={exeSvg} />,
  color: '#595959',
  label: '文件',
};

/** 取媒体元信息：文件夹优先用文件夹样式，未知类型回退默认 */
export function getMediaMeta(mediaType: number, isFolder = false): MediaMeta {
  if (isFolder) return MEDIA_META[FOLDER_MEDIA_TYPE];
  return MEDIA_META[mediaType] ?? MEDIA_META_DEFAULT;
}
