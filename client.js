// dsh-introspect —— 浏览器半边（ModuleLoader 单文件模块，零外部依赖）。
//
// 职责：
// - 「MEL」按钮：挂 conversation.session.header.actions（list 槽），点击切换右侧
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

			//#region 会话数据与 introspect 工具结果检测
			/** 双代会话快照（0.1.2-rc.1+ useChat.legacy.nodes / ≤0.1.1 useSession.nodes）。 */
			function conversationNodesOf(s) {
				if (!s) return EMPTY_NODES;
				const legacy = s.legacy;
				if (legacy && Array.isArray(legacy.nodes)) return legacy.nodes;
				return Array.isArray(s.nodes) ? s.nodes : EMPTY_NODES;
			}

			/** 工具结果文本块提取。 */
			function resultTextOfBlocks(blocks) {
				return (blocks ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
			}

			/**
			 * introspect_* 节点的结构指纹：数组长度 + 逐节点身份（kind / callId /
			 * call.name / isError）。只含结构身份、不含 content 文本——流式 token 增长
			 * 不改变指纹，只有新工具结果节点出现才变。用作 useChat 的第二 selector，
			 * 值比较天然绕过引用相等短路。
			 */
			function introspectFingerprint(nodes) {
				if (!Array.isArray(nodes)) return "[]";
				const parts = [String(nodes.length)];
				const visit = (node, depth) => {
					if (!node || typeof node !== "object") { parts.push("·"); return; }
					if (node.kind === "tool-result") {
						const name = node.call?.name;
						if (typeof name === "string" && INTROSPECT_TOOLS.has(name)) {
							parts.push(String(node.callId ?? ""), name, node.isError ? "E" : "-");
						}
					}
					const subCalls = Array.isArray(node.subCalls) ? node.subCalls : null;
					if (subCalls && depth < 100) {
						for (const subCall of subCalls) visit(subCall, depth + 1);
					}
				};
				for (const node of nodes) visit(node, 0);
				return parts.join("|");
			}

			/**
			 * 从会话节点树里找到最近一次 introspect_record 的 id（面板用它来
			 * 突出「刚记录」的事件）。递归走 subCalls（Code 等工具会嵌套结果）。
			 */
			function latestRecordedId(nodes) {
				if (!Array.isArray(nodes)) return null;
				let best = null;
				let bestKey = "";
				const visited = new WeakSet();
				function walk(node, pathKey) {
					if (!node || typeof node !== "object" || visited.has(node)) return;
					visited.add(node);
					if (node.kind === "tool-result" && node.call?.name === "introspect_record" && !node.isError) {
						const text = resultTextOfBlocks(node.content);
						let parsed;
						try { parsed = JSON.parse(text); } catch { parsed = null; }
						if (parsed && parsed.ok === true && parsed.event?.id != null) {
							const callId = node.callId ?? node.call?.callId;
							const key = callId != null ? `call:${String(callId)}` : `node:${pathKey}`;
							if (key > bestKey) { best = parsed.event.id; bestKey = key; }
						}
					}
					const subCalls = Array.isArray(node.subCalls) ? node.subCalls : null;
					if (subCalls) {
						for (let i = 0; i < subCalls.length; i++) walk(subCalls[i], `${pathKey}/${i}`);
					}
				}
				for (let i = 0; i < nodes.length; i++) walk(nodes[i], String(i));
				return typeof best === "number" ? best : null;
			}

			/** 归一化到0-100 同轴绘图（不改数据库里的原始值）。 */
			function normalizeTo100(value, max) {
				if (typeof value !== "number" || !Number.isFinite(value)) return null;
				if (typeof max !== "number" || max <= 0) return null;
				return Math.max(0, Math.min(100, (value / max) * 100));
			}

			/** 分钟→紧凑展示（122→2h02m）。 */
			function formatMinutes(minutes) {
				if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
				const total = Math.round(minutes);
				const hours = Math.floor(total / 60);
				const mins = total % 60;
				if (hours === 0) return `${mins}m`;
				if (mins === 0) return `${hours}h`;
				return `${hours}h${String(mins).padStart(2, "0")}m`;
			}

			/** 有符号数展示。 */
			function signed(value, digits) {
				if (typeof value !== "number" || !Number.isFinite(value)) return null;
				const d = typeof digits === "number" ? digits : 0;
				const rounded = Number(value.toFixed(d));
				const text = d > 0 ? rounded.toFixed(d) : String(rounded);
				return rounded > 0 ? `+${text}` : text;
			}

			/** 码位安全的有界截断（附省略号）。 */
			function trimForList(text, limit) {
				const chars = [...String(text ?? "")];
				const cap = typeof limit === "number" && limit > 0 ? limit : 120;
				if (chars.length <= cap) return String(text ?? "");
				return `${chars.slice(0, cap - 1).join("")}…`;
			}
			//#endregion

			//#region MEL × RRI 纯 SVG 图表（零依赖、响应式、主题跟随）
			const CHART_PAD = { top: 8, right: 4, bottom: 20, left: 4 };
			const CHART_DEFAULTS = { width: 300, height: 120 };
			const MEL_COLOR = "var(--dsw-alias-state-business-primary, #6366f1)";
			const RRI_COLOR = "var(--dsw-alias-state-success-primary, #14b8a6)";
			const GAP_COLOR = "var(--dsw-alias-state-business-primary, #6366f1)";
			const TICK_COLOR = "var(--dsw-alias-label-tertiary, #9ca3af)";
			const MEL_MAX = 200;
			const RRI_MAX = 100;

			function plotArea(width, height) {
				const left = CHART_PAD.left;
				const top = CHART_PAD.top;
				const w = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
				const h = Math.max(1, height - CHART_PAD.top - CHART_PAD.bottom);
				return { left, top, w, h };
			}

			function scaleX(index, count, area) {
				if (count <= 1) return area.left + area.w * 0.5;
				return area.left + (index / (count - 1)) * area.w;
			}

			function scaleY(value100, area) {
				if (value100 == null || !Number.isFinite(value100)) return null;
				return area.top + area.h - Math.max(0, Math.min(100, value100)) * area.h / 100;
			}

			function polylinePath(points) {
				if (points.length === 0) return "";
				let d = "";
				for (let i = 0; i < points.length; i++) {
					const p = points[i];
					if (p.y == null) continue;
					d += (d === "" ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1);
				}
				return d;
			}

			function tickLabels(series) {
				const times = series.map((p) => p.time).filter(Boolean);
				if (times.length === 0) return [];
				const picks = [0];
				if (times.length >= 4) {
					picks.push(Math.floor(times.length * 0.33));
					picks.push(Math.floor(times.length * 0.66));
				}
				if (times.length >= 2) picks.push(times.length - 1);
				return [...new Set(picks)].filter((i) => i < times.length).sort((a, b) => a - b).map((i) => ({
					index: i,
					label: localClock(times[i]),
				}));
			}

			function lastNonNull(series, key) {
				for (let i = series.length - 1; i >= 0; i--) {
					const value = series[i][key];
					if (typeof value === "number" && Number.isFinite(value)) return { index: i, value };
				}
				return null;
			}

			/**
			 * 纯函数：从时间序列数据算出整个 SVG 的几何信息。
			 * 面板 React 组件拿到返回值后只负责渲染 JSX，不做任何计算。
			 */
			function buildChartPaths(series, width, height) {
				const w = typeof width === "number" && width > 0 ? width : CHART_DEFAULTS.width;
				const h = typeof height === "number" && height > 0 ? height : CHART_DEFAULTS.height;
				const area = plotArea(w, h);
				if (!Array.isArray(series) || series.length === 0) {
					return { viewBox: `0 0 ${w} ${h}`, width: w, height: h, empty: true, mel: null, rri: null, gap: null, ticks: [], legend: [], current: [] };
				}
				const n = series.length;
				const coords = series.map((point, i) => ({
					x: scaleX(i, n, area),
					melY: scaleY(normalizeTo100(point.mel, MEL_MAX), area),
					rriY: scaleY(normalizeTo100(point.rri, RRI_MAX), area),
					mel: point.mel,
					rri: point.rri,
					time: point.time,
					summary: point.summary ?? "",
				}));
				const melPath = polylinePath(coords.map((c) => ({ x: c.x, y: c.melY })));
				const rriPath = polylinePath(coords.map((c) => ({ x: c.x, y: c.rriY })));
				let gapPath = "";
				if (coords.length >= 2) {
					let lastBothKnown = false;
					let segStart = -1;
					for (let i = 0; i < coords.length; i++) {
						const both = coords[i].melY != null && coords[i].rriY != null;
						if (both && !lastBothKnown) segStart = i;
						if (!both && lastBothKnown && segStart >= 0) {
							gapPath += buildGapSegment(coords, segStart, i);
							segStart = -1;
						}
						lastBothKnown = both;
					}
					if (lastBothKnown && segStart >= 0) gapPath += buildGapSegment(coords, segStart, coords.length);
				}
				const ticks = tickLabels(series);
				const ticksScaled = ticks.map((t) => ({ ...t, x: scaleX(t.index, n, area).toFixed(1) }));
				const melLast = lastNonNull(series, "mel");
				const rriLast = lastNonNull(series, "rri");
				const current = [];
				if (melLast) current.push({ label: "MEL", value: melLast.value, x: scaleX(melLast.index, n, area), y: scaleY(normalizeTo100(melLast.value, MEL_MAX), area), color: MEL_COLOR });
				if (rriLast) current.push({ label: "RRI", value: rriLast.value, x: scaleX(rriLast.index, n, area), y: scaleY(normalizeTo100(rriLast.value, RRI_MAX), area), color: RRI_COLOR });
				return {
					viewBox: `0 0 ${w} ${h}`,
					width: w,
					height: h,
					empty: false,
					mel: melPath ? { path: melPath, color: MEL_COLOR, label: "MEL", last: melLast?.value ?? null } : null,
					rri: rriPath ? { path: rriPath, color: RRI_COLOR, label: "RRI", last: rriLast?.value ?? null } : null,
					gap: gapPath ? { path: gapPath } : null,
					ticks: ticksScaled,
					legend: [
						{ label: "MEL", color: MEL_COLOR, value: melLast?.value ?? null },
						{ label: "RRI", color: RRI_COLOR, value: rriLast?.value ?? null },
					],
					current,
				};
			}

			function buildGapSegment(coords, from, to) {
				const upper = [];
				const lower = [];
				for (let i = from; i < to; i++) {
					if (coords[i].melY == null || coords[i].rriY == null) continue;
					upper.push({ x: coords[i].x, y: coords[i].melY });
					lower.push({ x: coords[i].x, y: coords[i].rriY });
				}
				if (upper.length < 2) return "";
				let d = `M${upper[0].x.toFixed(1)} ${upper[0].y.toFixed(1)}`;
				for (let i = 1; i < upper.length; i++) d += `L${upper[i].x.toFixed(1)} ${upper[i].y.toFixed(1)}`;
				for (let i = lower.length - 1; i >= 0; i--) d += `L${lower[i].x.toFixed(1)} ${lower[i].y.toFixed(1)}`;
				return d + "Z";
			}

			/** 从时钟文字取本地时区 HH:mm（客户端用浏览器 Intl 即可，不依赖 host 时区）。 */
			function localClock(iso) {
				try {
					const d = new Date(String(iso));
					if (Number.isNaN(d.getTime())) return "";
					const hh = String(d.getHours()).padStart(2, "0");
					const mm = String(d.getMinutes()).padStart(2, "0");
					return `${hh}:${mm}`;
				} catch {
					return "";
				}
			}
			//#endregion

			//#region 主题样式（全部跟随宿主 --dsw-alias-* 变量，亮/暗自动）
			const S = {
				mButton: { display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 8px", height: "22px", background: "var(--dsw-alias-fill-tsp-secondary)", color: "var(--dsw-alias-label-secondary)", border: "none", borderRadius: "6px", cursor: "pointer", font: "inherit", fontSize: "12px", whiteSpace: "nowrap" },
				panelHost: { position: "fixed", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none", zIndex: 40 },
				overlayRoot: { position: "absolute", top: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", minWidth: 0, borderLeft: "1px solid var(--dsw-alias-border-l2)", boxShadow: "-8px 0 24px rgba(16,24,40,0.10)", pointerEvents: "auto" },
				overlayHandle: { position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1 },
				header: { padding: "10px 14px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none", display: "flex", flexDirection: "column", gap: "8px" },
				headerTitle: { fontSize: "13px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--dsw-alias-label-secondary)", margin: "0 0 2px 0" },
				metricsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 12px", fontSize: "12px", lineHeight: 1.4, minWidth: 0 },
				metricCell: { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 },
				metricLabel: { color: "var(--dsw-alias-label-tertiary)", fontSize: "10px", letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
				metricValue: { fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
				metricSub: { color: "var(--dsw-alias-label-tertiary)", fontSize: "10px", whiteSpace: "nowrap" },
				gapRow: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", marginTop: "2px" },
				chartWrap: { padding: "10px 14px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none" },
				chartHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" },
				chartLegend: { display: "flex", gap: "10px", fontSize: "11px" },
				legendItem: { display: "inline-flex", alignItems: "center", gap: "4px" },
				legendDot: { width: "8px", height: "8px", borderRadius: "50%", flex: "none" },
				legendLabel: { color: "var(--dsw-alias-label-secondary)", fontVariantNumeric: "tabular-nums" },
				chartSvg: { display: "block", width: "100%", height: "auto" },
				recentWrap: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "8px 0" },
				recentHeader: { padding: "0 14px 6px", fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--dsw-alias-label-tertiary)" },
				recentItem: { padding: "6px 14px", cursor: "pointer", transition: "background 0.08s ease", borderBottom: "1px solid var(--dsw-alias-border-l2)" },
				recentItemHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
				recentTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" },
				recentTime: { flex: "none", fontSize: "11px", fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-tertiary)" },
				recentSummary: { flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 500 },
				recentMetrics: { display: "flex", gap: "8px", fontSize: "10px", color: "var(--dsw-alias-label-tertiary)", marginTop: "2px", fontVariantNumeric: "tabular-nums" },
				recentMetricChip: { whiteSpace: "nowrap" },
				detailWrap: { padding: "14px", display: "flex", flexDirection: "column", gap: "8px" },
				detailBack: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "12px", color: "var(--dsw-alias-state-business-primary)", padding: "0", marginBottom: "4px" },
				detailSummary: { fontSize: "14px", fontWeight: 600, lineHeight: 1.4, margin: "0" },
				detailRaw: { fontSize: "12px", lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)", margin: "0", padding: "8px 10px", background: "var(--dsw-alias-fill-tsp-secondary)", borderRadius: "8px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
				detailRow: { display: "flex", justifyContent: "space-between", fontSize: "12px", gap: "8px", minHeight: "22px" },
				detailLabel: { color: "var(--dsw-alias-label-tertiary)", flex: "none" },
				detailValue: { fontWeight: 500, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
				detailReason: { fontSize: "11px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)", margin: "2px 0 0", padding: "6px 10px", background: "var(--dsw-alias-fill-tsp-secondary)", borderRadius: "6px" },
				detailTags: { display: "flex", flexWrap: "wrap", gap: "4px" },
				detailTag: { fontSize: "10px", padding: "2px 8px", borderRadius: "6px", background: "var(--dsw-alias-fill-tsp-secondary)", color: "var(--dsw-alias-label-secondary)" },
				emptyWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", height: "100%", padding: "32px 16px", textAlign: "center" },
				emptyIcon: { fontSize: "28px", lineHeight: 1, opacity: 0.5 },
				emptyTitle: { fontSize: "14px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", margin: "0" },
				emptyHint: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", margin: "0", lineHeight: 1.5 },
				loadingWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--dsw-alias-label-tertiary)", fontSize: "13px" },
				refreshBtn: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", padding: "2px 6px", borderRadius: "4px", lineHeight: 1 },
				refreshBtnHover: { color: "var(--dsw-alias-label-primary)", background: "var(--dsw-alias-interactive-bg-hover)" },
				footer: { padding: "6px 14px", borderTop: "1px solid var(--dsw-alias-border-l2)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", color: "var(--dsw-alias-label-caption)", flex: "none" },
			};
			//#endregion

			//#region IntrospectWorkspace（壳无关面板组件：slot-agnostic，sidebar/standalone 共用）
			/**
			 * 主面板组件：五指标、MEL × RRI 曲线、Recent Events、事件详情。
			 * 面板数据全部来自 face.fetchDashboard()，工具结果的 introspectFingerprint
			 * 每次变化就重新拉一次（零通道、无轮询）。
			 *
			 * props：
			 *   sessionId        会话 id
			 *   introspectFace   { fetchDashboard, readEvent, setDraft, revokeApproval }
			 *   nodesVersion     introspectFingerprint 返回值，变化=有新事件，触发 refetch
			 *   visible          boolean（面板是否可见；不可见时仍挂载，但跳过拉取）
			 *   onAutoOpen       新事件到达且面板收起时，父级据此拉起面板
			 *   headerHeight     面板头部对齐高度（standalone 壳传入，sidebar 壳传 null）
			 *   variant          "standalone" | "sidebar"
			 */
			function IntrospectWorkspace(props) {
				const { sessionId, introspectFace: face, nodesVersion, visible, onAutoOpen, headerHeight, variant } = props;
				const [dashboard, setDashboard] = react.useState(null);
				const [loading, setLoading] = react.useState(false);
				const [error, setError] = react.useState(null);
				const [detailId, setDetailId] = react.useState(null);
				const [detail, setDetail] = react.useState(null);
				const [detailLoading, setDetailLoading] = react.useState(false);
				const [hovered, setHovered] = react.useState(null);
				const seenVersionRef = react.useRef(null);
				const pendingRef = react.useRef(null);

				// 拉取面板数据：有新 fingerprint 就重新拉。
				const refresh = react.useCallback(async () => {
					if (!face || typeof face.fetchDashboard !== "function") return;
					if (pendingRef.current) return;
					setLoading(true);
					pendingRef.current = true;
					try {
						const value = await face.fetchDashboard(sessionId);
						if (value && value.ok) {
							setDashboard(value);
							setError(null);
						}
					} catch (e) {
						if (e) setError(e.message ?? "fetch failed");
					} finally {
						pendingRef.current = null;
						setLoading(false);
					}
				}, [face, sessionId]);

				// fingerprint 变化时：如果面板可见，立即刷新；如果不可见，让父级
				// 拉起面板（新事件到达时应该看到它）。第一次只记基线，不弹窗。
				react.useEffect(() => {
					if (!nodesVersion) return;
					if (seenVersionRef.current === null) {
						seenVersionRef.current = nodesVersion;
						if (visible) refresh();
						return;
					}
					if (nodesVersion !== seenVersionRef.current) {
						seenVersionRef.current = nodesVersion;
						if (visible) refresh();
						else if (typeof onAutoOpen === "function") onAutoOpen();
					}
				}, [nodesVersion, visible, refresh, onAutoOpen]);

				// 面板变可见时：第一次或有错误就拉一次。
				react.useEffect(() => {
					if (visible && !dashboard && !loading) refresh();
				}, [visible, dashboard, loading, refresh]);

				// 事件详情：点 recent 事件后按 id 拉取。
				const openDetail = react.useCallback(async (id) => {
					if (!face || typeof face.readEvent !== "function") return;
					setDetailId(id);
					setDetailLoading(true);
					try {
						const event = await face.readEvent(sessionId, id);
						setDetail(event);
					} catch {
						setDetail(null);
					} finally {
						setDetailLoading(false);
					}
				}, [face, sessionId]);

				const closeDetail = react.useCallback(() => {
					setDetailId(null);
					setDetail(null);
				}, []);

				if (detailId !== null) {
					return (0, react_jsx_runtime.jsx)(DetailPanel, {
						detail: detail,
						loading: detailLoading,
						onBack: closeDetail,
						variant,
					});
				}

				if (loading && !dashboard) {
					return (0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children: "Loading…" });
				}

				if (error && !dashboard) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S.emptyWrap, children: [
						(0, react_jsx_runtime.jsx)("div", { style: S.emptyIcon, children: "⚠" }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyTitle, children: "Load failed" }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: error }),
					] });
				}

				if (!dashboard || dashboard.totals.count === 0) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S.emptyWrap, children: [
						(0, react_jsx_runtime.jsx)("div", { style: S.emptyIcon, children: "◎" }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyTitle, children: "Nothing recorded yet." }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: "Start with one event." }),
						typeof face?.setDraft === "function" ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: S.emptyHint,
							onClick: () => face.setDraft("记录一下："),
							children: "＋ Record",
						}) : null,
					] });
				}

				const chart = buildChartPaths(dashboard.series, 300, 120);
				return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
					(0, react_jsx_runtime.jsxs)("div", { style: S.header, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [
							(0, react_jsx_runtime.jsx)("h3", { style: S.headerTitle, children: "Introspect" }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", style: S.refreshBtn, onClick: refresh, children: loading ? "…" : "↻" }),
						] }),
						(0, react_jsx_runtime.jsx)(MetricsGrid, { today: dashboard.today, window: dashboard.window }),
						dashboard.today.gap !== null ? (0, react_jsx_runtime.jsxs)("div", { style: S.gapRow, children: [
							(0, react_jsx_runtime.jsx)("span", { children: "Energy − Reality (raw)" }),
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: signed(dashboard.today.gap) }),
						] }) : null,
					] }),
					dashboard.series.length > 0 ? (0, react_jsx_runtime.jsxs)("div", { style: S.chartWrap, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: S.chartHeader, children: [
							(0, react_jsx_runtime.jsx)("span", { children: `Last ${dashboard.hours}h` }),
							(0, react_jsx_runtime.jsx)("div", { style: S.chartLegend, children: chart.legend.map((item) =>
								(0, react_jsx_runtime.jsxs)("span", { style: S.legendItem, children: [
									(0, react_jsx_runtime.jsx)("span", { style: { ...S.legendDot, background: item.color } }),
									(0, react_jsx_runtime.jsxs)("span", { style: S.legendLabel, children: [item.label, " ", item.value ?? "-"] }),
								] }, item.label)
							) }),
						] }),
						(0, react_jsx_runtime.jsx)(MelRriChart, { chart: chart }),
					] }) : null,
					dashboard.recent.length > 0 ? (0, react_jsx_runtime.jsxs)("div", { style: S.recentWrap, children: [
						(0, react_jsx_runtime.jsx)("div", { style: S.recentHeader, children: "Recent" }),
						dashboard.recent.map((event) =>
							(0, react_jsx_runtime.jsxs)("div", {
								style: hovered === event.id ? { ...S.recentItem, ...S.recentItemHover } : S.recentItem,
								onMouseEnter: () => setHovered(event.id),
								onMouseLeave: () => setHovered(null),
								onClick: () => openDetail(event.id),
								children: [
									(0, react_jsx_runtime.jsxs)("div", { style: S.recentTop, children: [
										(0, react_jsx_runtime.jsx)("span", { style: S.recentSummary, children: event.summary }),
										(0, react_jsx_runtime.jsx)("span", { style: S.recentTime, children: event.clock || event.stamp }),
									] }),
									(0, react_jsx_runtime.jsxs)("div", { style: S.recentMetrics, children: [
										event.mel != null ? (0, react_jsx_runtime.jsx)("span", { style: S.recentMetricChip, children: `MEL ${event.mel}` }) : null,
										event.rri != null ? (0, react_jsx_runtime.jsx)("span", { style: S.recentMetricChip, children: `RRI ${event.rri}` }) : null,
										event.tsaMinutes != null ? (0, react_jsx_runtime.jsx)("span", { style: S.recentMetricChip, children: formatMinutes(event.tsaMinutes) }) : null,
									] }),
								],
							}, event.id)
						),
					] }) : null,
					(0, react_jsx_runtime.jsx)("div", { style: S.footer, children: (0, react_jsx_runtime.jsx)("span", { children: "Local SQLite · No upload" }) }),
				] });
			}

			/** 五指标网格：latest + band + trend/avg 子行。 */
			function MetricsGrid(props) {
				const { today } = props;
				const cells = [
					{ label: "MEL", value: today.mel, sub: today.melDirection !== "flat" ? `${today.melDirection === "up" ? "↗" : today.melDirection === "down" ? "↘" : "→"} ${today.melDirection}` : "→ flat" },
					{ label: "RRI", value: today.rri, sub: today.rriAvg != null ? `avg ${today.rriAvg}` : null },
					{ label: "ROI", value: today.roi, sub: "today" },
					{ label: "ARCTIC", value: today.arctic, sub: "Σ" },
					{ label: "TSA", value: today.tsaText, sub: `${today.count} events` },
				];
				return (0, react_jsx_runtime.jsx)("div", { style: S.metricsGrid, children: cells.map((cell) =>
					(0, react_jsx_runtime.jsxs)("div", { style: S.metricCell, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.metricLabel, children: cell.label }),
						(0, react_jsx_runtime.jsx)("span", { style: S.metricValue, children: cell.value ?? "-" }),
						cell.sub ? (0, react_jsx_runtime.jsx)("span", { style: S.metricSub, children: cell.sub }) : null,
					] }, cell.label)
				) });
			}

			/** MEL × RRI SVG 图表：buildChartPaths 的纯渲染。 */
			function MelRriChart(props) {
				const { chart } = props;
				if (!chart || chart.empty) return null;
				return (0, react_jsx_runtime.jsxs)("svg", {
					style: S.chartSvg,
					viewBox: chart.viewBox,
					preserveAspectRatio: "none",
					role: "img",
					"aria-label": "MEL x RRI time series",
					children: [
						chart.gap ? (0, react_jsx_runtime.jsx)("path", { d: chart.gap.path, fill: GAP_COLOR, fillOpacity: 0.08, stroke: "none" }) : null,
						chart.mel ? (0, react_jsx_runtime.jsx)("path", { d: chart.mel.path, fill: "none", stroke: chart.mel.color, strokeWidth: "1.6", strokeLinejoin: "round" }) : null,
						chart.rri ? (0, react_jsx_runtime.jsx)("path", { d: chart.rri.path, fill: "none", stroke: chart.rri.color, strokeWidth: "1.6", strokeLinejoin: "round" }) : null,
						chart.current.map((dot) =>
							(0, react_jsx_runtime.jsx)("circle", {
								cx: dot.x.toFixed(1),
								cy: dot.y.toFixed(1),
								r: "3",
								fill: dot.color,
								stroke: "var(--dsw-alias-bg-base, #fff)",
								strokeWidth: "1.2",
							}, dot.label)
						),
						chart.ticks.map((tick) =>
							(0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
								(0, react_jsx_runtime.jsx)("line", { x1: tick.x, x2: tick.x, y1: CHART_PAD.top, y2: chart.height - CHART_PAD.bottom, stroke: "var(--dsw-alias-border-l2, #e5e7eb)", strokeWidth: "0.5", strokeDasharray: "2 2" }),
								(0, react_jsx_runtime.jsx)("text", { x: tick.x, y: chart.height - 4, fill: TICK_COLOR, fontSize: "9", textAnchor: "middle", fontVariantNumeric: "tabular-nums", children: tick.label }),
							] }, tick.x)
						),
					],
				});
			}

			/** 事件详情面板（点 recent 后展开）。 */
			function DetailPanel(props) {
				const { detail, loading, onBack, variant } = props;
				const S_ = variant === "sidebar" ? S : S;
				if (loading) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S_.detailWrap, children: [
						(0, react_jsx_runtime.jsx)("button", { type: "button", style: S_.detailBack, onClick: onBack, children: "← Back" }),
						(0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children: "Loading…" }),
					] });
				}
				if (!detail || !detail.event) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S_.detailWrap, children: [
						(0, react_jsx_runtime.jsx)("button", { type: "button", style: S_.detailBack, onClick: onBack, children: "← Back" }),
						(0, react_jsx_runtime.jsx)("div", { style: S.emptyHint, children: "Event not found." }),
					] });
				}
				const event = detail.event;
				const rows = [
					{ label: "MEL", value: event.mel, reason: event.melReason },
					{ label: "RRI", value: event.rri, reason: event.rriReason },
					{ label: "ROI", value: event.roi != null ? signed(event.roi, 1) : null, reason: event.roiReason },
					{ label: "ARCTIC", value: event.arctic != null ? signed(event.arctic) : null, reason: event.arcticReason },
					{ label: "TSA", value: event.tsaMinutes != null ? formatMinutes(event.tsaMinutes) : null, reason: null },
				];
				return (0, react_jsx_runtime.jsxs)("div", { style: S_.detailWrap, children: [
					(0, react_jsx_runtime.jsx)("button", { type: "button", style: S_.detailBack, onClick: onBack, children: "← Back" }),
					(0, react_jsx_runtime.jsx)("p", { style: S_.detailSummary, children: event.summary }),
					event.rawText ? (0, react_jsx_runtime.jsx)("pre", { style: S_.detailRaw, children: event.rawText }) : null,
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }, children: [
						rows.map((row) =>
							(0, react_jsx_runtime.jsxs)("div", { children: [
								(0, react_jsx_runtime.jsxs)("div", { style: S_.detailRow, children: [
									(0, react_jsx_runtime.jsx)("span", { style: S_.detailLabel, children: row.label }),
									(0, react_jsx_runtime.jsx)("span", { style: S_.detailValue, children: row.value ?? "-" }),
								] }),
								row.reason ? (0, react_jsx_runtime.jsx)("p", { style: S_.detailReason, children: row.reason }) : null,
							] }, row.label)
						),
					] }),
					event.gap !== null && event.gap !== undefined ? (0, react_jsx_runtime.jsxs)("div", { style: { ...S_.detailRow, marginTop: "2px" }, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S_.detailLabel, children: "Gap" }),
						(0, react_jsx_runtime.jsx)("span", { style: S_.detailValue, children: signed(event.gap) }),
					] }) : null,
					Array.isArray(event.tags) && event.tags.length > 0 ? (0, react_jsx_runtime.jsx)("div", { style: S_.detailTags, children: event.tags.map((tag) => (0, react_jsx_runtime.jsx)("span", { style: S_.detailTag, children: tag }, tag)) }) : null,
					event.eventTime ? (0, react_jsx_runtime.jsx)("p", { style: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", margin: "4px 0 0" }, children: event.eventTime }) : null,
				] });
			}
			//#endregion

			/**
			 * openMindmapTab → openIntrospectTab：向 Better Sidebar 发出按需展开 Tab 的请求，
			 * seed 附惰性 url 触发 BS 的内容型展开逻辑。
			 */
			function openIntrospectTab(svc, scope) {
				if (!svc || typeof svc.openTab !== "function") return;
				try {
					svc.openTab({ type: "dsh-introspect:introspect", url: "dsh-introspect://introspect" }, scope);
				} catch { /* BS 已卸载或方法缺失 */ }
			}

			/**
			 * 「MEL」槽位组件：同一槽位渲染按钮。betterSidebar 服务可用时走原生 Tab，
			 * 否则渲染独立 fixed 面板。
			 */
			function IntrospectSlot(props) {
				const { useSession, useChat, sessionId, inputActions, introspectFace } = props;
				const nodesHook = useChat ?? useSession;
				const nodes = nodesHook ? nodesHook(conversationNodesOf) : EMPTY_NODES;
				const nodesVersion = nodesHook ? nodesHook((s) => introspectFingerprint(conversationNodesOf(s))) : "";

				const sidebar = react.useSyncExternalStore(sidebarBus.subscribe, sidebarBus.get);
				const sidebarMode = sidebar !== null;

				// 会话数据桥：sidebar 模式下把头部槽位捕获的数据写入 sessionStore，
				// 供 IntrospectSidebarTab 读取（Tab 组件不接收头部槽位 props）。
				react.useEffect(() => {
					if (!sidebarMode || !sessionId) return;
					sessionStore.set(sessionId, { nodes, nodesVersion, inputActions, introspectFace });
				}, [sidebarMode, sessionId, nodes, nodesVersion, inputActions, introspectFace]);
				const lastSessionRef = react.useRef(null);
				react.useEffect(() => {
					if (!sidebarMode) {
						if (lastSessionRef.current) { sessionStore.delete(lastSessionRef.current); lastSessionRef.current = null; }
						return;
					}
					if (lastSessionRef.current && lastSessionRef.current !== sessionId) sessionStore.delete(lastSessionRef.current);
					lastSessionRef.current = sessionId;
				}, [sidebarMode, sessionId]);
				react.useEffect(() => { return () => { if (lastSessionRef.current) { sessionStore.delete(lastSessionRef.current); lastSessionRef.current = null; } }; }, []);

				// sidebar 模式 auto-open 兜底：新 introspect_record 到达时拉起 Tab。
				const sidebarSeen = react.useRef(null);
				const sidebarInited = react.useRef(false);
				react.useEffect(() => {
					if (!sidebarMode || !sessionId) { sidebarInited.current = false; return; }
					if (!sidebarInited.current) { sidebarInited.current = true; sidebarSeen.current = nodesVersion; return; }
					if (nodesVersion !== sidebarSeen.current) {
						sidebarSeen.current = nodesVersion;
						openIntrospectTab(sidebar, { sessionId });
					}
				}, [nodesVersion, sidebarMode, sessionId, sidebar]);

				const [open, setOpen] = react.useState(false);
				const buttonIcon = (0, react_jsx_runtime.jsx)("svg", {
					width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
					style: { opacity: 0.7, flex: "none" },
					children: [
						(0, react_jsx_runtime.jsx)("circle", { cx: 7, cy: 7, r: 5.5 }),
						(0, react_jsx_runtime.jsx)("path", { d: "M5 8.5 Q7 4 9 8.5" }),
						(0, react_jsx_runtime.jsx)("circle", { cx: 7, cy: 5.8, r: 0.6, fill: "currentColor", stroke: "none" }),
					],
				});

				if (sidebarMode) {
					return (0, react_jsx_runtime.jsx)(react.Fragment, { children: (0, react_jsx_runtime.jsxs)("button", {
						type: "button", title: "Introspect: open / close", style: S.mButton,
						onClick: () => openIntrospectTab(sidebar, { sessionId }),
						children: [buttonIcon, "MEL"],
					}) });
				}

				return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
					(0, react_jsx_runtime.jsxs)("button", {
						type: "button", title: "Introspect: open / close", style: S.mButton,
						onClick: () => setOpen((v) => !v),
						children: [buttonIcon, "MEL"],
					}),
					(0, react_jsx_runtime.jsx)(IntrospectDetailsPanel, {
						open, sessionId, introspectFace,
						nodes, nodesVersion, inputActions,
						onOpen: () => setOpen(true),
						onClose: () => setOpen(false),
					}),
				] });
			}

			//#region better-sidebar 共存：服务总线 + 会话数据桥
			const sidebarBus = (() => {
				let service = null;
				const listeners = new Set();
				return {
					get: () => service,
					set(svc) {
						service = svc || null;
						for (const fn of listeners) fn();
					},
					subscribe(fn) {
						listeners.add(fn);
						return () => { listeners.delete(fn); };
					},
				};
			})();

			const sessionStore = (() => {
				const sessions = new Map();
				const listeners = new Map();
				function notify(sessionId) {
					const set = listeners.get(sessionId);
					if (set) for (const fn of set) fn();
				}
				return {
					get(sessionId) { return sessions.get(sessionId) || null; },
					set(sessionId, data) { sessions.set(sessionId, data); notify(sessionId); },
					delete(sessionId) { sessions.delete(sessionId); notify(sessionId); },
					subscribe(sessionId, fn) {
						let set = listeners.get(sessionId);
						if (!set) { set = new Set(); listeners.set(sessionId, set); }
						set.add(fn);
						return () => { set.delete(fn); if (set.size === 0) listeners.delete(sessionId); };
					},
				};
			})();
			//#endregion

			/**
			 * Better Sidebar Tab：从 sessionStore 读头部槽位写入的数据，交给
			 * IntrospectWorkspace 渲染。visible=false 时仍挂载，hooks 照常跑。
			 */
			function IntrospectSidebarTab(props) {
				const { ctx, scope, visible } = props;
				const sessionId = scope && scope.sessionId;

				const subscribe = react.useCallback((fn) => sessionStore.subscribe(sessionId, fn), [sessionId]);
				const getSnapshot = react.useCallback(() => sessionStore.get(sessionId), [sessionId]);
				const data = react.useSyncExternalStore(subscribe, getSnapshot);

				const onAutoOpen = react.useCallback(() => {
					openIntrospectTab(ctx && ctx.betterSidebar, scope);
				}, [ctx, scope]);

				if (!data) {
					return (0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children: "等待会话数据…" });
				}

				return (0, react_jsx_runtime.jsx)(IntrospectWorkspace, {
					sessionId,
					introspectFace: data.introspectFace,
					nodesVersion: data.nodesVersion,
					visible,
					onAutoOpen,
					headerHeight: null,
					variant: "sidebar",
				});
			}

			/**
			 * 独立 fixed 壳：右缘贴边悬浮面板，左缘拖拽调宽。
			 * Better Sidebar 未安装时使用。
			 */
			function IntrospectDetailsPanel(props) {
				const { open, sessionId, introspectFace, nodesVersion, inputActions, onOpen, onClose } = props;
				const WIDTH_KEY = "dsh-introspect.panel-width";
				const [panelWidth, setPanelWidth] = react.useState(() => {
					try {
						const saved = Number(localStorage.getItem(WIDTH_KEY));
						const max = Math.round(window.innerWidth * 0.8);
						const min = Math.min(280, max);
						if (Number.isFinite(saved)) return Math.min(max, Math.max(min, saved));
					} catch { /* fallback */ }
					const max = Math.round(window.innerWidth * 0.8);
					return Math.min(max, Math.max(Math.min(280, max), Math.round(window.innerWidth * 0.36)));
				});
				react.useEffect(() => {
					const clamp = () => {
						setPanelWidth((prev) => {
							const max = Math.round(window.innerWidth * 0.8);
							const min = Math.min(280, max);
							return Math.min(max, Math.max(min, prev));
						});
					};
					clamp();
					window.addEventListener("resize", clamp);
					return () => window.removeEventListener("resize", clamp);
				}, []);

				const dragRef = react.useRef(null);
				function startResize(e) {
					e.preventDefault();
					dragRef.current = { startX: e.clientX, startWidth: panelWidth, latestWidth: panelWidth };
					const onMove = (ev) => {
						if (!dragRef.current) return;
						const max = Math.round(window.innerWidth * 0.8);
						const min = Math.min(280, max);
						const next = Math.min(max, Math.max(min, dragRef.current.startWidth + (dragRef.current.startX - ev.clientX)));
						dragRef.current.latestWidth = next;
						setPanelWidth(next);
					};
					const onUp = () => {
						try { localStorage.setItem(WIDTH_KEY, String(dragRef.current ? dragRef.current.latestWidth : panelWidth)); } catch { /* 忽略 */ }
						dragRef.current = null;
						window.removeEventListener("mousemove", onMove);
						window.removeEventListener("mouseup", onUp);
					};
					window.addEventListener("mousemove", onMove);
					window.addEventListener("mouseup", onUp);
				}

				react.useLayoutEffect(() => {
					if (typeof document === "undefined") return;
					if (open) document.documentElement.style.setProperty("--dsh-introspect-width", `${panelWidth}px`);
					else document.documentElement.style.removeProperty("--dsh-introspect-width");
					return () => { document.documentElement.style.removeProperty("--dsh-introspect-width"); };
				}, [open, panelWidth]);

				return (0, react_jsx_runtime.jsx)("div", {
					style: open ? S.panelHost : { display: "none" },
					children: (0, react_jsx_runtime.jsxs)("div", {
						style: open ? { ...S.overlayRoot, width: panelWidth } : { display: "none" },
						children: [
							open ? (0, react_jsx_runtime.jsx)("div", { style: S.overlayHandle, onMouseDown: startResize }) : null,
							(0, react_jsx_runtime.jsx)(IntrospectWorkspace, {
								sessionId,
								introspectFace,
								nodesVersion,
								visible: open,
								onAutoOpen: onOpen,
								onClose,
								headerHeight: 74,
								variant: "standalone",
							}),
						],
					}),
				});
			}

			function apply(ctx) {
				const face = {};

				// layout-push CSS：standalone 模式下推窄聊天区。
				if (typeof ctx.effect === "function") {
					ctx.effect(() => {
						if (typeof document === "undefined") return;
						let layoutStyle = null;
						function ensure() {
							if (typeof document === "undefined") return;
							if (sidebarBus.get()) {
								if (layoutStyle) { layoutStyle.remove(); layoutStyle = null; }
							} else {
								if (!layoutStyle) {
									layoutStyle = document.createElement("style");
									layoutStyle.setAttribute("data-dsh-introspect", "layout-push");
									layoutStyle.textContent = [
										"#root{",
										"margin-right:calc(var(--dsh-introspect-width,0px) + var(--dsh-sidebar-width,0px))!important;",
										"width:calc(100% - var(--dsh-introspect-width,0px) - var(--dsh-sidebar-width,0px))!important;",
										"transition:margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out),width var(--ds-transition-duration-slow) var(--ds-ease-in-out);",
										"}",
									].join("");
									document.head.appendChild(layoutStyle);
								}
							}
						}
						ensure();
						const unsub = sidebarBus.subscribe(ensure);
						return () => { unsub(); if (layoutStyle) { layoutStyle.remove(); layoutStyle = null; } };
					});
				}

				// betterSidebar 注册：服务可用时 Tab 替代独立面板。
				if (typeof ctx.inject === "function") {
					try {
						ctx.inject(["betterSidebar"], (ctx2) => {
							const svc = ctx2 && ctx2.betterSidebar;
							if (!svc || typeof svc.registerTab !== "function") return;
							const dispose = svc.registerTab({
								id: "dsh-introspect:introspect",
								title: () => "MEL",
								icon: (size) => (0, react_jsx_runtime.jsx)("svg", {
									width: size, height: size, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round",
									children: [
										(0, react_jsx_runtime.jsx)("circle", { cx: 7, cy: 7, r: 5.5 }),
										(0, react_jsx_runtime.jsx)("path", { d: "M5 8.5 Q7 4 9 8.5" }),
										(0, react_jsx_runtime.jsx)("circle", { cx: 7, cy: 5.8, r: 0.6, fill: "currentColor", stroke: "none" }),
									],
								}),
								order: 110,
								single: true,
								component: IntrospectSidebarTab,
							});
							sidebarBus.set(svc);
							return () => { sidebarBus.set(null); dispose(); };
						});
					} catch {
						// ctx.inject 不支持或服务名未注册：standalone 模式。
					}
				}

				// 只读数据面：客户端永远不经这条路写 SQLite。
				face.fetchDashboard = async (sessionId, options) => {
					const response = await fetch("/introspect/api/dashboard", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sessionId,
							tzOffsetMinutes: new Date().getTimezoneOffset(),
							hours: options?.hours ?? 24,
							recentLimit: options?.recentLimit ?? 8,
						}),
					});
					const parsed = await response.json().catch(() => null);
					if (!response.ok || parsed === null || parsed.ok !== true || !parsed.value) {
						throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
					}
					return parsed.value;
				};
				face.readEvent = async (sessionId, id) => {
					const response = await fetch("/introspect/api/event", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, id: Number(id) }),
					});
					const parsed = await response.json().catch(() => null);
					if (!response.ok || parsed === null || parsed.ok !== true || !parsed.value) {
						throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
					}
					return parsed.value;
				};

				// + Record 按钮把事件描述模板填进聊天输入框。
				face.setDraft = (text) => {
					// inputActions 从头部槽位传来；在独立面板里暂时不持有，
					// 该功能在 sidebar 模式下由 sessionStore 转发。v0.1 退化为无操作。
				};

				// settings.section 槽位（若将来需要面板设置面板）：v0.1 跳过，
				// 默认宽度取 localStorage；chartHours 取 24。

				ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "dsh-introspect",
					order: 110,
					inject: () => ({ introspectFace: face }),
				}, IntrospectSlot));
			}

			exports.apply = apply;
			exports.inject = inject;
			exports.internals = Object.freeze({
				conversationNodesOf,
				introspectFingerprint,
				latestRecordedId,
				normalizeTo100,
				formatMinutes,
				signed,
				trimForList,
				resultTextOfBlocks,
				buildChartPaths,
				linePath: typeof polylinePath === "function" ? polylinePath : null,
				chartGeometry: typeof buildChartPaths === "function" ? buildChartPaths : null,
				localClock,
				sidebarBus,
				sessionStore,
				IntrospectSlot,
				IntrospectWorkspace,
				S,
				INTROSPECT_TOOLS,
			});
			// close.js：ModuleLoader 工厂函数闭合花括号。
			// 同一逻辑块的物理拆分，拼接时不额外插空行（见 build-client.mjs）。
			// 这个文件是 apply.js 函数体的直接续写。
			return module.exports;
		},
	});
