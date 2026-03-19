# codex-detect

中文 | [English](./README.md)

CLIProxyAPI 认证管理面板。

## 功能特性

- 提供商标签页，支持大规模凭证集的快速状态筛选
- 虚拟化凭证表格，流畅渲染 1000+ 行数据
- 列头排序（点击切换升序/降序）
  - 文件名
  - 状态 / 额度
  - 额度重置时间
  - 最后刷新时间
- 批量测试和批量启用/禁用/删除操作
- 凭证上传弹窗
  - 拖放或文件选择器
  - 可配置并发池大小的并发上传（1 / 2 / 3 / 5 / 10）
  - 进度显示（已完成/总数，活跃上传数）
  - 一键重试失败的上传
- 测试结果在页面刷新后保持
  - 切换启用/禁用不再清除现有测试结果

## 截图展示

### 仪表盘
![仪表盘](./public/Dashboard.png)

### 使用监控
![使用监控](./public/Usage.png)

## 开发

```bash
pnpm install
pnpm dev
```

可选的本地开发代理（仅 Vite）：

```bash
VITE_PROXY_MODE=true VITE_ENDPOINT=http://localhost:8317 pnpm dev
```

## 构建

```bash
pnpm build
```

## 管理 API 说明

- 基础路径：`/v0/management`
- 认证文件列表：`GET /auth-files`
- 认证文件上传（multipart）：`POST /auth-files`
  - Multipart 字段名必须为 `file`（每次请求单个文件）

当 `VITE_PROXY_MODE=true` 时，前端 `/api/management/*` 请求会被 Vite 开发服务器代理到
`<VITE_ENDPOINT>/v0/management/*`。

## Cloudflare Pages 部署

- 框架预设：`None`
- 构建命令：`pnpm build`
- 构建输出目录：`dist`

`useProxy` 仅用于本地 Vite 开发。在 Cloudflare Pages 生产环境中，Vite 代理不会激活。

对于生产环境 API 访问，选择以下方式之一：

1. 目标端点支持你的 Pages 域名的 CORS
2. 在 Cloudflare 侧配置同源反向代理
