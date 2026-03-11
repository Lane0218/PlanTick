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
