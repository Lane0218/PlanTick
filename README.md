# PlanTick

PlanTick 现已转为 `Web / PWA` 方案。

目标是用一套网页同时覆盖：
- Windows 桌面浏览器
- 手机浏览器
- 可安装为 PWA 的桌面与移动端入口

当前技术主线：
- 前端：`React + TypeScript + Vite`
- 安装能力：`vite-plugin-pwa`
- 本地存储：`IndexedDB`
- 云端：`Supabase`
- 同步：本地优先 + 云端同步 + 实时订阅/补拉

## 仓库结构

- `doc/`
  - `SPEC.md`：产品与技术规格
  - `PLAN.md`：实施计划

> 之前的 Flutter 客户端和 Go 后端探索代码已经从主线方案中移除，不再作为当前实施基线。

## 当前状态

当前仓库已经完成方案收敛，主线以文档为准：
- 原生/准原生跨端路线已放弃
- 主线改为 Web/PWA
- 同步后端改为 Supabase
- 后续实现以 Web 前端项目为核心展开

当前实施基线：
- [doc/SPEC.md](doc/SPEC.md) 定义产品范围与技术约束
- [doc/PLAN.md](doc/PLAN.md) 定义可直接落地的实施顺序与关键架构决策

已固定的关键决策：
- 工作区口令通过服务端 `Edge Function` 校验
- 多设备同步采用本地优先 + 本地 outbox + 前台补拉
- 冲突规则采用最后更新时间覆盖
- 重复待办在完成当前实例后生成下一实例，并由服务端统一派生

## Phase 0 本地开发

启动前端：
- `npm install`
- `npm run dev`

前端环境变量：
- 复制 `.env.example` 为 `.env.local`
- 填入：
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

Supabase 本地 Spike：
- `supabase/migrations/20260311211000_phase0_workspace_spike.sql`
- `supabase/functions/workspace-create`
- `supabase/functions/workspace-join`

推荐本地流程：
- `supabase start`
- `supabase db reset`
- `supabase functions serve --env-file supabase/.env.local`

函数运行环境变量：
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

当前 Phase 0 页面已包含：
- PWA 注册与安装状态卡片
- IndexedDB 探针写入
- Supabase 匿名登录
- `workspace-create` / `workspace-join` 调用入口

当前远端 Supabase 项目状态：
- Phase 0 / Phase 1 migration 已应用
- `workspace-create` 与 `workspace-join` 已部署
- 已完成匿名登录、工作区创建/加入、PWA 注册与安装验证
- `categories`、`todos`、`events` 已作为 Phase 1 远端 schema 基线创建
