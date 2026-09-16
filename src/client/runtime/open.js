// Generated source fragment. Edit this file, then run npm run build:client.
// dsh-introspect —— 浏览器半边（ModuleLoader 单文件模块，零外部依赖）。
//
// 职责：
// - 「内观」按钮：挂 conversation.session.header.actions（list 槽），点击切换右侧
//   悬浮面板的开/合；Better Sidebar 服务可用时改为原生 Tab，不渲染独立面板。
// - 面板内容：五指标、MEL × RRI 时间曲线、Recent Events、实时刷新。
// - 实时刷新：消费会话快照里 introspect_* 工具结果，指纹变化后拉取面板数据；
//   无轮询、无自定义事件通道——与 dsh-mindmap 同一条零通道数据流。
// - 只读数据面：所有面板数据经 host 自建只读路由 /introspect/api/dashboard 取得。
//   客户端永远不直接写 SQLite（一切写入都经 DSH 模型调工具）。
window.__ModuleLoader__.load({
  id: "dsh-introspect",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");

    const inject = ["slots"];

    const INTROSPECT_TOOLS = new Set(["introspect_record", "introspect_update", "introspect_delete", "introspect_status", "introspect_today", "introspect_history", "introspect_get"]);
    const WRITING_TOOLS = new Set(["introspect_record", "introspect_update", "introspect_delete"]);
    const EMPTY_NODES = [];
