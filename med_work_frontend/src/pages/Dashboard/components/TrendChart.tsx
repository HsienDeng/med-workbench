import { Area } from '@ant-design/plots';
import { colors } from '@/theme';

export interface TrendPoint {
  date: string;
  count: number;
}

interface TrendChartProps {
  data: TrendPoint[];
}

/** AI 分析趋势面积图（单系列：近 N 天每日分析任务数） */
export default function TrendChart({ data }: TrendChartProps) {
  return (
    <Area
      data={data}
      xField="date"
      yField="count"
      height={260}
      style={{ fillOpacity: 0.9 }}
      scale={{ color: { range: [colors.primary] } }}
      axis={{
        y: { title: '任务数', labelFormatter: '~s' },
      }}
      line={{ style: { stroke: colors.primary, lineWidth: 2 } }}
      tooltip={{ title: 'date' }}
    />
  );
}
