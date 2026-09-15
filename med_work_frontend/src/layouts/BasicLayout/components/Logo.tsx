import { colors } from '@/theme';
import logo from '@/assets/logo.png';

export default function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: collapsed ? '0 16px' : '0 20px',
        borderBottom: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}
    >
      <img
        src={logo}
        alt="MedAI Workbench"
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          objectFit: 'cover',
          flexShrink: 0,
          display: 'block',
        }}
      />
      {!collapsed && (
        <div style={{ lineHeight: 1.15, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: colors.text, letterSpacing: -0.01 }}>
            MedAI Workbench
          </div>
          <div style={{ fontSize: 10, color: colors.textMuted }}>医疗 AI 工作台 · v1.0</div>
        </div>
      )}
    </div>
  );
}
