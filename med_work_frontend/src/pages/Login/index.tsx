import { useState } from 'react';
import { App as AntApp, Avatar, Button, Checkbox, Form, Input, Tooltip } from 'antd';
import {
  LockOutlined,
  MedicineBoxFilled,
  ReadOutlined,
  RobotOutlined,
  TeamOutlined,
  UserOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  loginApi,
  saveRememberedCredentials,
} from '@/services/auth';
import type { AuthUser } from '@/types';
import './index.css';

interface LoginPageProps {
  onLogin: (auth: { token: string; user: AuthUser; remember?: boolean }) => void;
}

interface LoginFormValues {
  account: string;
  password: string;
  remember?: boolean;
}

const FEATURES = [
  { icon: <RobotOutlined />, title: 'AI 病历分析', desc: '基于本机构知识库生成循证分析，结果自动保存' },
  { icon: <TeamOutlined />, title: '患者档案管理', desc: '患者信息与病历记录一站式管理' },
  { icon: <ReadOutlined />, title: '医学知识检索', desc: '指南、文献与药品说明书全文检索' },
  { icon: <WechatOutlined />, title: '企业微信随访', desc: '外部群同步，随访消息统一推送' },
];

const STATS = [
  { value: 'AI 分析', label: '循证结论自动生成' },
  { value: '私有知识库', label: '本机构文档支撑' },
  { value: '全程可追溯', label: '历史结果自动保存' },
];

/** 上次勾选"记住我"登录成功的账号+密码：进入登录页自动填充，并默认勾选 */
const REMEMBERED = loadRememberedCredentials();
if (import.meta.env.DEV) {
  console.log('[remember] on mount, cached =', REMEMBERED);
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [loginForm] = Form.useForm<LoginFormValues>();

  const handleLogin = async ({ remember, ...credentials }: LoginFormValues) => {
    setLoading(true);
    if (import.meta.env.DEV) {
      console.log('[remember] submit', {
        remember: Boolean(remember),
        account: credentials.account,
        passwordLen: (credentials.password ?? '').length,
      });
    }
    try {
      const { token, user } = await loginApi(credentials);
      // 「记住我」仅在登录成功后落库；勾选则写本地，取消勾选则清掉已保存的凭据
      if (remember) {
        saveRememberedCredentials({
          account: credentials.account,
          password: credentials.password,
        });
      } else {
        clearRememberedCredentials();
      }
      message.success(`欢迎回来，${user.real_name}`);
      onLogin({ token, user, remember: Boolean(remember) });
    } catch {
      // The global API layer displays the backend business message once.
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* ============ 左侧品牌展示区 ============ */}
      <section className="login-brand">
        <div className="login-brand-decor" aria-hidden="true">
          <span className="decor-ring ring-1" />
          <span className="decor-ring ring-2" />
          <span className="decor-ring ring-3" />
        </div>
        <div className="login-brand-inner">
          <div className="login-brand-logo">
            <Avatar
              size={44}
              shape="square"
              style={{
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.16)',
                border: '1px solid rgba(255, 255, 255, 0.24)',
                fontSize: 20,
                flex: 'none',
              }}
              icon={<MedicineBoxFilled />}
            />
            <div>
              <div className="login-logo-name">MedAI Workbench</div>
              <div className="login-logo-sub">医疗智能工作台</div>
            </div>
          </div>

          <h1 className="login-brand-title">让 AI 成为临床医生的智能助手</h1>
          <p className="login-brand-desc">
            以医疗大模型为引擎，覆盖 AI 病历分析、患者档案、知识库检索与企业微信随访的临床工作全流程。
          </p>

          <div className="login-features">
            {FEATURES.map((f) => (
              <div className="login-feature" key={f.title}>
                <div className="login-feature-icon">{f.icon}</div>
                <div>
                  <div className="login-feature-title">{f.title}</div>
                  <div className="login-feature-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="login-stats">
            {STATS.map((s) => (
              <div className="login-stat" key={s.label}>
                <div className="login-stat-value">{s.value}</div>
                <div className="login-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 右侧表单区 ============ */}
      <section className="login-panel">
        <div className="login-card">
          <div className="login-mobile-logo">
            <Avatar
              size={40}
              shape="square"
              style={{
                borderRadius: 10,
                background: 'linear-gradient(135deg, #2d6cdf, #7c5cff)',
                fontSize: 20,
              }}
              icon={<MedicineBoxFilled />}
            />
            <span>MedAI Workbench</span>
          </div>

          <div className="login-card-head">
            <h2>欢迎回来</h2>
            <p>登录 MedAI Workbench，继续你的临床工作</p>
          </div>

          <Form<LoginFormValues>
            form={loginForm}
            onFinish={handleLogin}
            requiredMark={false}
            size="large"
            initialValues={{
              account: REMEMBERED?.account ?? '',
              password: REMEMBERED?.password ?? '',
              remember: Boolean(REMEMBERED?.account),
            }}
          >
            <Form.Item
              name="account"
              rules={[{ required: true, whitespace: true, message: '请输入账号' }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="请输入账号"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少 6 位' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>
            <div className="login-options">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Tooltip title="勾选后账号+密码会保存到本地浏览器，下次进入登录页自动填充；取消勾选并登录成功后会清掉已保存的账号+密码">
                  <Checkbox>记住我</Checkbox>
                </Tooltip>
              </Form.Item>
              <a className="login-forgot" onClick={() => message.info('请联系科室管理员重置密码')}>
                忘记密码？
              </a>
            </div>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              className="login-submit"
            >
              登 录
            </Button>
          </Form>

          {/* <div className="login-demo-tip">
            演示账号 <b>{DEMO_ACCOUNT.account}</b> / <b>{DEMO_ACCOUNT.password}</b>
            <a
              onClick={() =>
                loginForm.setFieldsValue({
                  account: DEMO_ACCOUNT.account,
                  password: DEMO_ACCOUNT.password,
                })
              }
            >
              一键填入
            </a>
          </div> */}
        </div>

        <div className="login-footer">© 2026 MedAI Workbench · 医疗智能工作台</div>
      </section>
    </div>
  );
}
