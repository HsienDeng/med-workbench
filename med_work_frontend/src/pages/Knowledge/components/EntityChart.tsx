import { useMemo } from 'react';
import { Pie } from '@ant-design/plots';
import { colors } from '@/theme';
import type { EntityDistributionItem } from '@/types';

interface EntityChartProps {
  data: EntityDistributionItem[];
}

/** 知识库实体分布环形图 */
export default function EntityChart({ data }: EntityChartProps) {
  const config = useMemo(
    () => ({
      data: data.map((e) => ({ name: e.name, value: e.value })),
      angleField: 'value',
      colorField: 'name',
      innerRadius: 0.62,
      label: {
        text: (d: any) => `${d.name}`,
        position: 'outside',
        style: { fontSize: 11, fill: colors.textSecondary },
      },
      legend: { color: { position: 'right' } },
      scale: {
        color: {
          range: [colors.primary, colors.ai, colors.purple, colors.warning],
        },
      },
      annotations: [
        {
          type: 'text',
          style: {
            text: '48.6万\n实体总数',
            x: '50%',
            y: '50%',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 700,
            fill: colors.text,
            lineHeight: 20,
          },
        },
      ],
      tooltip: {
        items: [{ channel: 'y', valueFormatter: (d: any) => `${d} 万` }],
      },
    }),
    [data],
  );

  return <Pie {...config} height={260} />;
}
