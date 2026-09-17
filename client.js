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

				/** Normalized Energy-Reality Gap: MEL/2 - RRI，同轴语义一致。 */
				function normalizedGap(mel, rri) {
					if (typeof mel !== "number" || typeof rri !== "number") return null;
					return Math.round((mel / 2 - rri) * 100) / 100;
				}

				/** Gap 方向文字（克制、无判断）。 */
				function gapDirectionText(gap) {
					if (typeof gap !== "number" || !Number.isFinite(gap)) return "";
					if (Math.abs(gap) < 1) return "aligned";
					return gap > 0 ? "energy ahead" : "reality ahead";
				}

				/** 客户端 MEL 区间查找（与 src/metrics.js MEL_BANDS 一致）。 */
				function melBand(value) {
					if (typeof value !== "number" || !Number.isFinite(value)) return null;
					if (value < 60) return { key: "low", label: "low energy" };
					if (value < 80) return { key: "normal", label: "balanced" };
					if (value < 100) return { key: "high", label: "creative" };
					return { key: "over", label: "over-limit" };
				}

				/** 客户端 RRI 区间查找（与 src/metrics.js RRI_BANDS 一致）。 */
				function rriBand(value) {
					if (typeof value !== "number" || !Number.isFinite(value)) return null;
					if (value <= 20) return { key: "very_low", label: "very low" };
					if (value <= 40) return { key: "low", label: "low" };
					if (value <= 60) return { key: "medium", label: "medium" };
					if (value <= 80) return { key: "high", label: "high" };
					return { key: "very_high", label: "very high" };
				}
			//#endregion

				//#region MEL × RRI 纯 SVG 图表 — observability-grade time series
				const CHART_PAD = { top: 12, right: 12, bottom: 26, left: 32 };
				const CHART_DEFAULTS = { width: 300, height: 160 };
				const MEL_COLOR = "var(--dsw-alias-state-business-primary, #818cf8)";
				const RRI_COLOR = "var(--dsw-alias-state-success-primary, #34d399)";
				const GAP_FILL = "var(--dsw-alias-state-business-primary, #818cf8)";
				const TICK_COLOR = "var(--dsw-alias-label-caption, #6b7280)";
				const GRID_COLOR = "var(--dsw-alias-border-l2, rgba(255,255,255,0.06))";
				const CROSSHAIR_COLOR = "var(--dsw-alias-label-caption, #6b7280)";
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

				function lastNonNull(series, key) {
					for (let i = series.length - 1; i >= 0; i--) {
						const value = series[i][key];
						if (typeof value === "number" && Number.isFinite(value)) return { index: i, value };
					}
					return null;
				}

				//#region 时间轴刻度生成
				/** ISO → Date ms，容错。 */
				function timeMs(iso) {
					if (!iso) return NaN;
					const ms = new Date(String(iso)).getTime();
					return Number.isFinite(ms) ? ms : NaN;
				}

				/** HH:mm 格式。 */
				function fmtHHmm(ms) {
					const d = new Date(ms);
					return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
				}

				/** MM-DD 格式。 */
				function fmtMMdd(ms) {
					const d = new Date(ms);
					return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
				}

				/** MM-DD HH:mm 格式。 */
				function fmtFull(ms) {
					return fmtMMdd(ms) + " " + fmtHHmm(ms);
				}

				/** 对齐到整 N 分钟。 */
				function snapMinute(ms, step) {
					return Math.floor(ms / (step * 60000)) * (step * 60000);
				}

				/** 对齐到整小时。 */
				function snapHour(ms) {
					return Math.floor(ms / 3600000) * 3600000;
				}

				/** 对齐到本地午夜。 */
				function snapDay(ms) {
					const d = new Date(ms);
					d.setHours(0, 0, 0, 0);
					return d.getTime();
				}

				/**
				 * 根据时间范围生成合理的时间轴刻度。
				 * 返回 [{ms, label}, ...]，保证2-5个刻度，不超出数据范围。
				 */
				function generateTimeTicks(series) {
					const times = [];
					for (const p of series) {
						const ms = timeMs(p.time);
						if (Number.isFinite(ms)) times.push(ms);
					}
					if (times.length === 0) return [];
					const lo = times[0];
					const hi = times[times.length - 1];
					const span = hi - lo;
					if (span <= 0) return [{ ms: lo, label: fmtHHmm(lo) }];
					const HOUR = 3600000;
					const DAY = 86400000;
					const result = [];
					if (span <= 10 * 60000) {
						// <10min: 每2分钟一个刻度
						let t = snapMinute(lo, 2);
						for (; t <= hi + 60000; t += 2 * 60000) {
							if (t >= lo - 60000) result.push({ ms: t, label: fmtHHmm(t) });
						}
					} else if (span <= HOUR) {
						// <1h: 每5/10/15分钟一个刻度
						const step = span <= 20 * 60000 ? 5 : span <= 40 * 60000 ? 10 : 15;
						let t = snapMinute(lo, step);
						for (; t <= hi + 60000; t += step * 60000) {
							if (t >= lo - 60000) result.push({ ms: t, label: fmtHHmm(t) });
						}
					} else if (span <= 6 * HOUR) {
						// <6h: 每30分钟或每小时
						const stepMin = span <= 3 * HOUR ? 30 : 60;
						let t = snapMinute(lo, stepMin);
						for (; t <= hi + 60000; t += stepMin * 60000) {
							if (t >= lo - 60000) result.push({ ms: t, label: fmtHHmm(t) });
						}
					} else if (span <= 24 * HOUR) {
						// <24h: 每2小时或3小时
						const stepH = span <= 12 * HOUR ? 2 : 3;
						let t = snapHour(lo);
						for (; t <= hi + 60000; t += stepH * HOUR) {
							if (t >= lo - HOUR) result.push({ ms: t, label: fmtHHmm(t) });
						}
					} else if (span <= 3 * DAY) {
						// <3天: 每天午夜 + 当前天的中午
						let t = snapDay(lo);
						for (; t <= hi + DAY; t += DAY) {
							if (t >= lo - DAY) {
								const d = new Date(t);
								const label = d.getDate() === new Date(lo).getDate() && d.getMonth() === new Date(lo).getMonth()
									? fmtHHmm(t) : fmtMMdd(t);
								result.push({ ms: t, label });
							}
						}
					} else {
						// >3天: 每天一个日期刻度
						let t = snapDay(lo);
						for (; t <= hi + DAY; t += DAY) {
							if (t >= lo - DAY) result.push({ ms: t, label: fmtMMdd(t) });
						}
					}
					// 首尾保底
					if (result.length === 0) {
						result.push({ ms: lo, label: fmtHHmm(lo) });
						if (span > 0) result.push({ ms: hi, label: fmtHHmm(hi) });
					} else {
						// 确保第一个刻度不晚于数据起点
						if (result[0].ms > lo + span * 0.15) {
							result.unshift({ ms: lo, label: fmtHHmm(lo) });
						}
						// 确保最后一个刻度不早于数据终点
						if (result[result.length - 1].ms < hi - span * 0.15) {
							result.push({ ms: hi, label: fmtHHmm(hi) });
						}
					}
					return result;
				}

				/** 将时间刻度映射到图表 x 坐标。 */
				function mapTimeTicksToX(ticks, series, area) {
					if (ticks.length === 0 || series.length === 0) return [];
					const times = series.map((p) => timeMs(p.time));
					const lo = times[0];
					const hi = times[times.length - 1];
					const span = hi - lo;
					return ticks.map((tick) => {
						const ratio = span > 0 ? (tick.ms - lo) / span : 0.5;
						const x = area.left + Math.max(0, Math.min(1, ratio)) * area.w;
						return { ...tick, x: x.toFixed(1) };
					});
				}
				//#endregion

				/**
				 * 纯函数：从时间序列数据算出整个 SVG 的几何信息。
				 * 返回值交给 React 组件做纯渲染，不做任何计算。
				 *
				 * 新增：
				 * - 使用 normalized MEL/2 绘图（与 RRI 同 0-100 轴）
				 * - 时间轴刻度基于真实时间映射
				 * - Y 轴网格线
				 * - hoverData 用于 crosshair/tooltip
				 * - sparse data 优雅处理
				 */
				function buildChartPaths(series, width, height) {
					const w = typeof width === "number" && width > 0 ? width : CHART_DEFAULTS.width;
					const h = typeof height === "number" && height > 0 ? height : CHART_DEFAULTS.height;
					const area = plotArea(w, h);
					if (!Array.isArray(series) || series.length === 0) {
						return { viewBox: `0 0 ${w} ${h}`, width: w, height: h, empty: true, mel: null, rri: null, gap: null, xTicks: [], yGrid: [], current: [], hoverData: null };
					}
					const n = series.length;
					// 归一化：MEL / 2 → 0-100，RRI → 0-100
					const coords = series.map((point, i) => ({
						x: scaleX(i, n, area),
						melY: scaleY(normalizeTo100(point.mel != null ? point.mel / 2 : null, MEL_MAX / 2), area),
						rriY: scaleY(normalizeTo100(point.rri, RRI_MAX), area),
						mel: point.mel,
						rri: point.rri,
						time: point.time,
						summary: point.summary ?? "",
					}));
					const melPath = polylinePath(coords.map((c) => ({ x: c.x, y: c.melY })));
					const rriPath = polylinePath(coords.map((c) => ({ x: c.x, y: c.rriY })));
					// Gap area: normalized MEL/2 vs RRI
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
					// 时间轴刻度：基于真实时间映射
					const rawTicks = generateTimeTicks(series);
					const xTicks = mapTimeTicksToX(rawTicks, series, area);
					// Y 轴网格：0, 50, 100
					const yGrid = [0, 50, 100].map((v) => ({
						value: v,
						y: scaleY(v, area).toFixed(1),
						label: String(v),
					}));
					// 当前值端点
					const melLast = lastNonNull(series, "mel");
					const rriLast = lastNonNull(series, "rri");
					const current = [];
					if (melLast) current.push({
						label: "MEL", value: melLast.value,
						normalized: Math.round(melLast.value / 2),
						x: scaleX(melLast.index, n, area), y: scaleY(normalizeTo100(melLast.value / 2, MEL_MAX / 2), area),
						color: MEL_COLOR,
					});
					if (rriLast) current.push({
						label: "RRI", value: rriLast.value,
						normalized: rriLast.value,
						x: scaleX(rriLast.index, n, area), y: scaleY(normalizeTo100(rriLast.value, RRI_MAX), area),
						color: RRI_COLOR,
					});
					// hover 数据：每个点的完整信息
					const hoverData = coords.map((c, i) => ({
						index: i,
						x: c.x,
						melY: c.melY,
						rriY: c.rriY,
						mel: c.mel,
						rri: c.rri,
						normalizedMel: c.mel != null ? Math.round(c.mel / 2) : null,
						gap: (typeof c.mel === "number" && typeof c.rri === "number") ? Math.round((c.mel / 2 - c.rri) * 100) / 100 : null,
						time: c.time,
						summary: c.summary,
					}));
					return {
						viewBox: `0 0 ${w} ${h}`,
						width: w,
						height: h,
						empty: false,
						mel: melPath ? { path: melPath, color: MEL_COLOR, label: "MEL", last: melLast?.value ?? null } : null,
						rri: rriPath ? { path: rriPath, color: RRI_COLOR, label: "RRI", last: rriLast?.value ?? null } : null,
						gap: gapPath ? { path: gapPath } : null,
						xTicks,
						yGrid,
						current,
						hoverData,
					};
				}

				/** 从时钟文字取本地时区 HH:mm（客户端用浏览器 Intl 即可）。 */
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

				//#region 主题样式 — observability console aesthetic
				// Spacing scale: 4 · 8 · 12 · 16 · 20 · 24
				// Typography: system-ui, tabular-nums for all numeric displays
				// Colors: follow host --dsw-alias-* variables, dark-mode native
				const S = {
					// ── Header ──
					header: { padding: "16px 16px 12px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none", display: "flex", flexDirection: "column", gap: "12px" },
					headerTitle: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--dsw-alias-label-tertiary)", margin: "0", display: "flex", alignItems: "center", gap: "8px" },
					headerSubtitle: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },
					liveDot: { width: "6px", height: "6px", borderRadius: "50%", background: "var(--dsw-alias-state-success-primary, #10b981)", flex: "none", opacity: 0.7 },
					refreshBtn: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "10px", color: "var(--dsw-alias-label-caption)", padding: "2px 4px", borderRadius: "3px", lineHeight: 1, marginLeft: "auto" },
					refreshBtnHover: { color: "var(--dsw-alias-label-secondary)" },

					// ── Hero Metrics (MEL / RRI) ──
					heroRow: { display: "flex", gap: "4px", alignItems: "stretch" },
					heroCell: { flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "8px 0", borderRadius: "6px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.03))" },
					heroLabel: { fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--dsw-alias-label-tertiary)" },
					heroValue: { fontSize: "28px", fontWeight: 300, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-primary)", letterSpacing: "-0.02em" },
					heroValueNull: { fontSize: "28px", fontWeight: 300, lineHeight: 1, color: "var(--dsw-alias-label-caption)", letterSpacing: "-0.02em" },
					heroBand: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },

					// ── Gap Strip ──
					gapStrip: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "6px 0", fontSize: "11px" },
					gapLabel: { color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },
					gapValue: { fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-secondary)" },
					gapDirection: { fontSize: "10px", color: "var(--dsw-alias-label-caption)" },

					// ── Secondary Metrics (ROI / ARCTIC / TSA) ──
					secondaryRail: { display: "flex", gap: "1px", borderTop: "1px solid var(--dsw-alias-border-l2)", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none" },
					secondaryCell: { flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "8px 4px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.02))" },
					secondaryLabel: { fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)" },
					secondaryValue: { fontSize: "14px", fontWeight: 500, fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-secondary)" },
					secondaryValueNull: { fontSize: "14px", fontWeight: 400, color: "var(--dsw-alias-label-caption)" },
					secondaryHint: { fontSize: "9px", color: "var(--dsw-alias-label-caption)" },

					// ── Chart Section ──
					chartWrap: { padding: "12px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none", position: "relative" },
					chartHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" },
					chartRange: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },
					chartLegend: { display: "flex", gap: "12px", fontSize: "11px" },
					legendItem: { display: "inline-flex", alignItems: "center", gap: "5px" },
					legendDot: { width: "7px", height: "7px", borderRadius: "50%", flex: "none" },
					legendLabel: { color: "var(--dsw-alias-label-tertiary)", fontSize: "10px", letterSpacing: "0.02em" },
					legendValue: { color: "var(--dsw-alias-label-secondary)", fontVariantNumeric: "tabular-nums", fontWeight: 500, fontSize: "11px" },
					chartSvg: { display: "block", width: "100%", height: "auto", cursor: "crosshair" },
					chartEmpty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", padding: "24px 16px", textAlign: "center" },
					chartEmptyText: { fontSize: "11px", color: "var(--dsw-alias-label-caption)" },

					// ── Tooltip (floating, positioned by JS) ──
					tooltip: { position: "absolute", pointerEvents: "none", background: "var(--dsw-alias-bg-elevated, rgba(20,20,28,0.95))", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", padding: "8px 10px", fontSize: "10px", lineHeight: 1.5, zIndex: 10, minWidth: "120px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", fontVariantNumeric: "tabular-nums", transition: "opacity 0.1s ease" },
					tooltipTime: { fontSize: "11px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginBottom: "4px", letterSpacing: "0.01em" },
					tooltipRow: { display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--dsw-alias-label-secondary)" },
					tooltipLabel: { color: "var(--dsw-alias-label-tertiary)" },
					tooltipVal: { fontWeight: 500 },
					tooltipDivider: { height: "1px", background: "var(--dsw-alias-border-l2)", margin: "4px 0" },

					// ── Today Strip ──
					todayStrip: { padding: "8px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" },
					todayLeft: { display: "flex", alignItems: "center", gap: "8px" },
					todayLabel: { fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)" },
					todayInfo: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", fontVariantNumeric: "tabular-nums" },

					// ── Recent Timeline ──
					recentWrap: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "0" },
					recentHeader: { padding: "10px 16px 6px", fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)", position: "sticky", top: 0, background: "var(--dsw-alias-bg-base)", zIndex: 1 },
					recentDayGroup: { padding: "0 0 0" },
					recentDayLabel: { padding: "6px 16px 2px", fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)" },
					recentItem: { padding: "8px 16px", cursor: "pointer", transition: "background 0.08s ease", borderTop: "1px solid var(--dsw-alias-border-l2)" },
					recentItemHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
					recentTime: { fontSize: "10px", fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-caption)", marginBottom: "2px", letterSpacing: "0.01em" },
					recentSummary: { fontSize: "12px", lineHeight: 1.45, fontWeight: 400, color: "var(--dsw-alias-label-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
					recentChips: { display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" },
					chip: { fontSize: "10px", padding: "1px 6px", borderRadius: "3px", fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" },
					chipMel: { background: "color-mix(in srgb, var(--dsw-alias-state-business-primary, #6366f1) 15%, transparent)", color: "var(--dsw-alias-state-business-primary, #818cf8)" },
					chipRri: { background: "color-mix(in srgb, var(--dsw-alias-state-success-primary, #10b981) 15%, transparent)", color: "var(--dsw-alias-state-success-primary, #34d399)" },
					chipRoi: { background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.05))", color: "var(--dsw-alias-label-tertiary)" },
					chipTsa: { background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.05))", color: "var(--dsw-alias-label-tertiary)" },

					// ── Detail Panel ──
					detailWrap: { padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
					detailBack: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "11px", color: "var(--dsw-alias-state-business-primary, #818cf8)", padding: "0", letterSpacing: "0.01em" },
					detailSummary: { fontSize: "14px", fontWeight: 500, lineHeight: 1.4, margin: "0", color: "var(--dsw-alias-label-primary)" },
					detailRaw: { fontSize: "11px", lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)", margin: "0", padding: "10px 12px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.03))", borderRadius: "6px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
					detailRow: { display: "flex", justifyContent: "space-between", fontSize: "12px", gap: "8px", minHeight: "20px" },
					detailLabel: { color: "var(--dsw-alias-label-tertiary)", flex: "none", fontSize: "10px", letterSpacing: "0.04em", textTransform: "uppercase" },
					detailValue: { fontWeight: 500, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
					detailReason: { fontSize: "11px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)", margin: "2px 0 0", padding: "6px 10px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.03))", borderRadius: "4px" },
					detailTags: { display: "flex", flexWrap: "wrap", gap: "4px" },
					detailTag: { fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.05))", color: "var(--dsw-alias-label-secondary)" },

					// ── Empty / Loading States ──
					emptyWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", height: "100%", padding: "40px 24px", textAlign: "center" },
					emptyTitle: { fontSize: "13px", fontWeight: 500, color: "var(--dsw-alias-label-secondary)", margin: "0" },
					emptyHint: { fontSize: "11px", color: "var(--dsw-alias-label-caption)", margin: "0", lineHeight: 1.5 },
					loadingWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--dsw-alias-label-caption)", fontSize: "12px" },

					// ── Footer ──
					footer: { padding: "8px 16px", borderTop: "1px solid var(--dsw-alias-border-l2)", display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "var(--dsw-alias-label-caption)", flex: "none" },
					footerDot: { width: "4px", height: "4px", borderRadius: "50%", background: "var(--dsw-alias-label-caption)", opacity: 0.5, flex: "none" },

					// ── Slot Button (header action) ──
					mButton: { display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 8px", height: "22px", background: "var(--dsw-alias-fill-tsp-secondary)", color: "var(--dsw-alias-label-secondary)", border: "none", borderRadius: "6px", cursor: "pointer", font: "inherit", fontSize: "12px", whiteSpace: "nowrap" },

					// ── Panel Shell (standalone mode) ──
					panelHost: { position: "fixed", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none", zIndex: 40 },
					overlayRoot: { position: "absolute", top: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", minWidth: 0, borderLeft: "1px solid var(--dsw-alias-border-l2)", boxShadow: "-8px 0 24px rgba(16,24,40,0.10)", pointerEvents: "auto" },
					overlayHandle: { position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1 },
				};
				//#endregion

				//#region IntrospectWorkspace — Personal Observability Console
				/**
				 * 主面板组件：Hero metrics、Energy-Reality chart、Timeline。
				 * 面板数据全部来自 face.fetchDashboard()，工具结果的 introspectFingerprint
				 * 每次变化就重新拉一次（零通道、无轮询）。
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
					const [chartHover, setChartHover] = react.useState(null);
					const [refreshHover, setRefreshHover] = react.useState(false);
					const chartWrapRef = react.useRef(null);
					const seenVersionRef = react.useRef(null);
					const pendingRef = react.useRef(null);

					const refresh = react.useCallback(async () => {
						if (!face || typeof face.fetchDashboard !== "function") return;
						if (pendingRef.current) return;
						setLoading(true);
						pendingRef.current = true;
						try {
							const value = await face.fetchDashboard(sessionId);
							if (value && value.ok) { setDashboard(value); setError(null); }
						} catch (e) {
							if (e) setError(e.message ?? "fetch failed");
						} finally {
							pendingRef.current = null;
							setLoading(false);
						}
					}, [face, sessionId]);

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

					react.useEffect(() => {
						if (visible && !dashboard && !loading) refresh();
					}, [visible, dashboard, loading, refresh]);

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
						return (0, react_jsx_runtime.jsx)(DetailPanel, { detail: detail, loading: detailLoading, onBack: closeDetail, variant });
					}

					if (loading && !dashboard) {
						return (0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children: "Loading…" });
					}

					if (error && !dashboard) {
						return (0, react_jsx_runtime.jsxs)("div", { style: S.emptyWrap, children: [
							(0, react_jsx_runtime.jsx)("p", { style: S.emptyTitle, children: "Load failed" }),
							(0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: error }),
						] });
					}

					if (!dashboard || dashboard.totals.count === 0) {
						return (0, react_jsx_runtime.jsxs)("div", { style: S.emptyWrap, children: [
							(0, react_jsx_runtime.jsx)("p", { style: S.emptyTitle, children: "No observations yet." }),
							(0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: "Record something worth observing." }),
							typeof face?.setDraft === "function" ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "11px", color: "var(--dsw-alias-state-business-primary, #818cf8)", padding: "4px 8px", marginTop: "4px" },
								onClick: () => face.setDraft("记录一下："),
								children: "＋ Record",
							}) : null,
						] });
					}

					const chart = buildChartPaths(dashboard.series, 300, 160);
					const normGap = dashboard.normalizedGap;
					const lastTime = dashboard.today.lastEventTime;
					const lastClock = lastTime ? localClock(lastTime) : null;

					return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
						// ── Header ──
						(0, react_jsx_runtime.jsxs)("div", { style: S.header, children: [
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
								(0, react_jsx_runtime.jsxs)("h3", { style: S.headerTitle, children: [
									(0, react_jsx_runtime.jsx)("span", { style: S.liveDot }),
									"INTROSPECT",
									(0, react_jsx_runtime.jsx)("span", { style: S.headerSubtitle, children: "Self-observability" }),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: refreshHover ? { ...S.refreshBtn, ...S.refreshBtnHover } : S.refreshBtn,
										onClick: refresh,
										onMouseEnter: () => setRefreshHover(true),
										onMouseLeave: () => setRefreshHover(false),
										children: loading ? "…" : "↻",
									}),
								] }),
							] }),
							// ── Hero: MEL / RRI ──
							(0, react_jsx_runtime.jsx)(HeroMetrics, { today: dashboard.today }),
							// ── Gap ──
							normGap !== null ? (0, react_jsx_runtime.jsxs)("div", { style: S.gapStrip, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.gapLabel, children: "GAP" }),
								(0, react_jsx_runtime.jsx)("span", { style: S.gapValue, children: signed(normGap) }),
								(0, react_jsx_runtime.jsx)("span", { style: S.gapDirection, children: gapDirectionText(normGap) }),
							] }) : null,
						] }),
						// ── Secondary: ROI / ARCTIC / TSA ──
						(0, react_jsx_runtime.jsx)(SecondaryRail, { today: dashboard.today }),
						// ── Chart ──
						dashboard.series.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
							style: S.chartWrap,
							ref: chartWrapRef,
							children: [
								(0, react_jsx_runtime.jsxs)("div", { style: S.chartHeader, children: [
									(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
										(0, react_jsx_runtime.jsx)("span", { style: S.chartRange, children: `Last ${dashboard.hours}h` }),
										(0, react_jsx_runtime.jsxs)("div", { style: S.chartLegend, children: [
											(0, react_jsx_runtime.jsxs)("span", { style: S.legendItem, children: [
												(0, react_jsx_runtime.jsx)("span", { style: { ...S.legendDot, background: MEL_COLOR } }),
												(0, react_jsx_runtime.jsx)("span", { style: S.legendLabel, children: "MEL" }),
												chart.mel ? (0, react_jsx_runtime.jsx)("span", { style: S.legendValue, children: chart.mel.last ?? "—" }) : null,
											] }),
											(0, react_jsx_runtime.jsxs)("span", { style: S.legendItem, children: [
												(0, react_jsx_runtime.jsx)("span", { style: { ...S.legendDot, background: RRI_COLOR } }),
												(0, react_jsx_runtime.jsx)("span", { style: S.legendLabel, children: "RRI" }),
												chart.rri ? (0, react_jsx_runtime.jsx)("span", { style: S.legendValue, children: chart.rri.last ?? "—" }) : null,
											] }),
										] }),
									] }),
								] }),
								(0, react_jsx_runtime.jsx)(MelRriChart, {
									chart: chart,
									hoverIndex: chartHover ? chartHover.index : null,
									onHover: setChartHover,
									onLeave: () => setChartHover(null),
								}),
								chartHover ? (0, react_jsx_runtime.jsx)(ChartTooltip, { hover: chartHover, chart: chart, containerRef: chartWrapRef }) : null,
							],
						}) : (0, react_jsx_runtime.jsx)("div", { style: S.chartWrap, children: (0, react_jsx_runtime.jsxs)("div", { style: S.chartEmpty, children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.chartEmptyText, children: "No chart data in this window." }),
						] }) }),
						// ── Today Strip ──
						(0, react_jsx_runtime.jsxs)("div", { style: S.todayStrip, children: [
							(0, react_jsx_runtime.jsxs)("div", { style: S.todayLeft, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.todayLabel, children: "TODAY" }),
								(0, react_jsx_runtime.jsxs)("span", { style: S.todayInfo, children: [
									dashboard.today.count,
									" event",
									dashboard.today.count !== 1 ? "s" : "",
									lastClock ? ` · last ${lastClock}` : "",
								] }),
							] }),
						] }),
						// ── Recent Timeline ──
						dashboard.recent.length > 0 ? (0, react_jsx_runtime.jsxs)("div", { style: S.recentWrap, children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.recentHeader, children: "RECENT" }),
							dashboard.recent.map(function (event) {
								return (0, react_jsx_runtime.jsxs)("div", {
									style: hovered === event.id ? { ...S.recentItem, ...S.recentItemHover } : S.recentItem,
									onMouseEnter: function () { setHovered(event.id); },
									onMouseLeave: function () { setHovered(null); },
									onClick: function () { openDetail(event.id); },
									children: [
										(0, react_jsx_runtime.jsx)("div", { style: S.recentTime, children: event.clock || event.stamp }),
										(0, react_jsx_runtime.jsx)("div", { style: S.recentSummary, children: event.summary }),
										(0, react_jsx_runtime.jsxs)("div", { style: S.recentChips, children: [
											event.mel != null ? (0, react_jsx_runtime.jsxs)("span", { style: { ...S.chip, ...S.chipMel }, children: ["MEL ", event.mel] }) : null,
											event.rri != null ? (0, react_jsx_runtime.jsxs)("span", { style: { ...S.chip, ...S.chipRri }, children: ["RRI ", event.rri] }) : null,
											event.roi != null ? (0, react_jsx_runtime.jsxs)("span", { style: { ...S.chip, ...S.chipRoi }, children: [signed(event.roi, 1)] }) : null,
											event.tsaMinutes != null ? (0, react_jsx_runtime.jsx)("span", { style: { ...S.chip, ...S.chipTsa }, children: formatMinutes(event.tsaMinutes) }) : null,
										] }),
									],
								}, event.id);
							}),
						] }) : null,
						// ── Footer ──
						(0, react_jsx_runtime.jsxs)("div", { style: S.footer, children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.footerDot }),
							(0, react_jsx_runtime.jsx)("span", { children: "Local SQLite" }),
							(0, react_jsx_runtime.jsx)("span", { style: S.footerDot }),
							(0, react_jsx_runtime.jsx)("span", { children: "No telemetry" }),
						] }),
					] });
				}

				/** Hero metrics: MEL / RRI 大字展示。 */
				function HeroMetrics(props) {
					var today = props.today;
					var melBandKey = today.mel != null ? melBand(today.mel) : null;
					var rriBandKey = today.rri != null ? rriBand(today.rri) : null;
					var melDir = today.melDirection;
					var melTrend = today.melTrend;
					return (0, react_jsx_runtime.jsxs)("div", { style: S.heroRow, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: S.heroCell, children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.heroLabel, children: "MEL" }),
							today.mel != null ? (0, react_jsx_runtime.jsx)("span", { style: S.heroValue, children: today.mel }) : (0, react_jsx_runtime.jsx)("span", { style: S.heroValueNull, children: "—" }),
							(0, react_jsx_runtime.jsxs)("span", { style: S.heroBand, children: [
								melBandKey ? melBandKey.label : "—",
								melDir !== "flat" && melTrend !== null ? " " + (melDir === "up" ? "↑" : "↓") + " " + Math.abs(Math.round(melTrend)) : "",
							] }),
						] }),
						(0, react_jsx_runtime.jsxs)("div", { style: S.heroCell, children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.heroLabel, children: "RRI" }),
							today.rri != null ? (0, react_jsx_runtime.jsx)("span", { style: S.heroValue, children: today.rri }) : (0, react_jsx_runtime.jsx)("span", { style: S.heroValueNull, children: "—" }),
							(0, react_jsx_runtime.jsxs)("span", { style: S.heroBand, children: [
								rriBandKey ? rriBandKey.label : "—",
								today.rriAvg != null ? " · avg " + today.rriAvg : "",
							] }),
						] }),
					] });
				}

				/** 二级指标横条：ROI / ARCTIC / TSA。 */
				function SecondaryRail(props) {
					var today = props.today;
					var cells = [
						{ label: "ROI", value: today.roi != null ? signed(today.roi, 1) : null, hint: "today Σ" },
						{ label: "ARCTIC", value: today.arctic != null ? signed(today.arctic) : null, hint: "direction" },
						{ label: "TSA", value: today.tsaText, hint: today.count + " events" },
					];
					return (0, react_jsx_runtime.jsx)("div", { style: S.secondaryRail, children: cells.map(function (cell) {
						return (0, react_jsx_runtime.jsxs)("div", { style: S.secondaryCell, children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.secondaryLabel, children: cell.label }),
							cell.value != null ? (0, react_jsx_runtime.jsx)("span", { style: S.secondaryValue, children: cell.value }) : (0, react_jsx_runtime.jsx)("span", { style: S.secondaryValueNull, children: "—" }),
							(0, react_jsx_runtime.jsx)("span", { style: S.secondaryHint, children: cell.hint }),
						] }, cell.label);
					}) });
				}

				/** MEL × RRI SVG 图表：带时间轴、网格、hover。 */
				function MelRriChart(props) {
					var chart = props.chart;
					var hoverIndex = props.hoverIndex;
					var onHover = props.onHover;
					var onLeave = props.onLeave;
					if (!chart || chart.empty) return null;

					function handleMouseMove(e) {
						if (!chart.hoverData || chart.hoverData.length === 0) return;
						var svg = e.currentTarget;
						var rect = svg.getBoundingClientRect();
						var svgX = (e.clientX - rect.left) / rect.width * chart.width;
						var best = null;
						var bestDist = Infinity;
						for (var i = 0; i < chart.hoverData.length; i++) {
							var d = Math.abs(chart.hoverData[i].x - svgX);
							if (d < bestDist) { bestDist = d; best = chart.hoverData[i]; }
						}
						if (best) {
							onHover({ index: best.index, mouseX: e.clientX, mouseY: e.clientY, data: best });
						}
					}

					return (0, react_jsx_runtime.jsxs)("svg", {
						style: S.chartSvg,
						viewBox: chart.viewBox,
						preserveAspectRatio: "xMidYMid meet",
						role: "img",
						"aria-label": "MEL x RRI time series",
						onMouseMove: handleMouseMove,
						onMouseLeave: onLeave,
						children: [
							// Y 轴网格
							chart.yGrid.map(function (g) {
								return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
									(0, react_jsx_runtime.jsx)("line", { x1: CHART_PAD.left, x2: chart.width - CHART_PAD.right, y1: g.y, y2: g.y, stroke: GRID_COLOR, strokeWidth: "0.5" }),
									(0, react_jsx_runtime.jsx)("text", { x: CHART_PAD.left - 4, y: Number(g.y) + 3, fill: TICK_COLOR, fontSize: "8", textAnchor: "end", fontVariantNumeric: "tabular-nums", children: g.label }),
								] }, "y" + g.value);
							}),
							// Gap area fill
							chart.gap ? (0, react_jsx_runtime.jsx)("path", { d: chart.gap.path, fill: GAP_FILL, fillOpacity: 0.06, stroke: "none" }) : null,
							// Lines
							chart.mel ? (0, react_jsx_runtime.jsx)("path", { d: chart.mel.path, fill: "none", stroke: chart.mel.color, strokeWidth: "1.5", strokeLinejoin: "round", strokeLinecap: "round" }) : null,
							chart.rri ? (0, react_jsx_runtime.jsx)("path", { d: chart.rri.path, fill: "none", stroke: chart.rri.color, strokeWidth: "1.5", strokeLinejoin: "round", strokeLinecap: "round" }) : null,
							// X 轴刻度
							chart.xTicks.map(function (tick) {
								return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
									(0, react_jsx_runtime.jsx)("line", { x1: tick.x, x2: tick.x, y1: CHART_PAD.top, y2: chart.height - CHART_PAD.bottom, stroke: GRID_COLOR, strokeWidth: "0.5" }),
									(0, react_jsx_runtime.jsx)("text", { x: tick.x, y: chart.height - 8, fill: TICK_COLOR, fontSize: "8", textAnchor: "middle", fontVariantNumeric: "tabular-nums", children: tick.label }),
								] }, "x" + tick.x);
							}),
							// Current value endpoints
							chart.current.map(function (dot) {
								return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
									(0, react_jsx_runtime.jsx)("circle", { cx: dot.x.toFixed(1), cy: dot.y.toFixed(1), r: "4", fill: "var(--dsw-alias-bg-base, #111)", stroke: dot.color, strokeWidth: "1.5" }),
									(0, react_jsx_runtime.jsx)("circle", { cx: dot.x.toFixed(1), cy: dot.y.toFixed(1), r: "2", fill: dot.color }),
								] }, "ep-" + dot.label);
							}),
							// Crosshair
							hoverIndex != null && chart.hoverData && chart.hoverData[hoverIndex] ? (0, react_jsx_runtime.jsx)("line", {
								x1: chart.hoverData[hoverIndex].x,
								x2: chart.hoverData[hoverIndex].x,
								y1: CHART_PAD.top,
								y2: chart.height - CHART_PAD.bottom,
								stroke: CROSSHAIR_COLOR,
								strokeWidth: "0.5",
								strokeDasharray: "3 2",
								pointerEvents: "none",
							}) : null,
							// Hover dots
							hoverIndex != null && chart.hoverData && chart.hoverData[hoverIndex] ? (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
								chart.hoverData[hoverIndex].melY != null ? (0, react_jsx_runtime.jsx)("circle", { cx: chart.hoverData[hoverIndex].x, cy: chart.hoverData[hoverIndex].melY, r: "3", fill: MEL_COLOR, stroke: "var(--dsw-alias-bg-base, #111)", strokeWidth: "1", pointerEvents: "none" }) : null,
								chart.hoverData[hoverIndex].rriY != null ? (0, react_jsx_runtime.jsx)("circle", { cx: chart.hoverData[hoverIndex].x, cy: chart.hoverData[hoverIndex].rriY, r: "3", fill: RRI_COLOR, stroke: "var(--dsw-alias-bg-base, #111)", strokeWidth: "1", pointerEvents: "none" }) : null,
							] }) : null,
						],
					});
				}

				/** Chart tooltip（hover 时显示的浮层）。 */
				function ChartTooltip(props) {
					var hover = props.hover;
					var containerRef = props.containerRef;
					if (!hover || !hover.data) return null;
					var d = hover.data;
					var containerRect = containerRef.current ? containerRef.current.getBoundingClientRect() : null;
					var left = containerRect ? hover.mouseX - containerRect.left + 12 : 0;
					var top = containerRect ? hover.mouseY - containerRect.top - 10 : 0;
					// 边界修正
					if (containerRect && left > containerRect.width - 140) left = left - 152;
					if (top < 0) top = 8;
					return (0, react_jsx_runtime.jsxs)("div", {
						style: { ...S.tooltip, left: left + "px", top: top + "px" },
						children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.tooltipTime, children: d.time ? localClock(d.time) : "" }),
							d.mel != null ? (0, react_jsx_runtime.jsxs)("div", { style: S.tooltipRow, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.tooltipLabel, children: "MEL" }),
								(0, react_jsx_runtime.jsxs)("span", { style: S.tooltipVal, children: [d.mel, " → ", d.normalizedMel] }),
							] }) : null,
							d.rri != null ? (0, react_jsx_runtime.jsxs)("div", { style: S.tooltipRow, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.tooltipLabel, children: "RRI" }),
								(0, react_jsx_runtime.jsx)("span", { style: S.tooltipVal, children: d.rri }),
							] }) : null,
							d.gap !== null ? (0, react_jsx_runtime.jsxs)("div", { children: [
								(0, react_jsx_runtime.jsx)("div", { style: S.tooltipDivider }),
								(0, react_jsx_runtime.jsxs)("div", { style: S.tooltipRow, children: [
									(0, react_jsx_runtime.jsx)("span", { style: S.tooltipLabel, children: "Gap" }),
									(0, react_jsx_runtime.jsx)("span", { style: S.tooltipVal, children: signed(d.gap) }),
								] }),
							] }) : null,
						],
					});
				}

				/** 事件详情面板。 */
				function DetailPanel(props) {
					var detail = props.detail;
					var loading = props.loading;
					var onBack = props.onBack;
					if (loading) {
						return (0, react_jsx_runtime.jsxs)("div", { style: S.detailWrap, children: [
							(0, react_jsx_runtime.jsx)("button", { type: "button", style: S.detailBack, onClick: onBack, children: "← Back" }),
							(0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children: "Loading…" }),
						] });
					}
					if (!detail || !detail.event) {
						return (0, react_jsx_runtime.jsxs)("div", { style: S.detailWrap, children: [
							(0, react_jsx_runtime.jsx)("button", { type: "button", style: S.detailBack, onClick: onBack, children: "← Back" }),
							(0, react_jsx_runtime.jsx)("div", { style: S.emptyHint, children: "Event not found." }),
						] });
					}
					var event = detail.event;
					var rows = [
						{ label: "MEL", value: event.mel, reason: event.melReason },
						{ label: "RRI", value: event.rri, reason: event.rriReason },
						{ label: "ROI", value: event.roi != null ? signed(event.roi, 1) : null, reason: event.roiReason },
						{ label: "ARCTIC", value: event.arctic != null ? signed(event.arctic) : null, reason: event.arcticReason },
						{ label: "TSA", value: event.tsaMinutes != null ? formatMinutes(event.tsaMinutes) : null, reason: null },
					];
					var ng = normalizedGap(event.mel, event.rri);
					return (0, react_jsx_runtime.jsxs)("div", { style: S.detailWrap, children: [
						(0, react_jsx_runtime.jsx)("button", { type: "button", style: S.detailBack, onClick: onBack, children: "← Back" }),
						(0, react_jsx_runtime.jsx)("p", { style: S.detailSummary, children: event.summary }),
						event.rawText ? (0, react_jsx_runtime.jsx)("pre", { style: S.detailRaw, children: event.rawText }) : null,
						(0, react_jsx_runtime.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }, children: rows.map(function (row) {
							return (0, react_jsx_runtime.jsxs)("div", { children: [
								(0, react_jsx_runtime.jsxs)("div", { style: S.detailRow, children: [
									(0, react_jsx_runtime.jsx)("span", { style: S.detailLabel, children: row.label }),
									(0, react_jsx_runtime.jsx)("span", { style: S.detailValue, children: row.value ?? "—" }),
								] }),
								row.reason ? (0, react_jsx_runtime.jsx)("p", { style: S.detailReason, children: row.reason }) : null,
							] }, row.label);
						}) }),
						ng !== null ? (0, react_jsx_runtime.jsxs)("div", { style: { ...S.detailRow, marginTop: "4px" }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.detailLabel, children: "GAP" }),
							(0, react_jsx_runtime.jsx)("span", { style: S.detailValue, children: signed(ng) }),
						] }) : null,
						Array.isArray(event.tags) && event.tags.length > 0 ? (0, react_jsx_runtime.jsx)("div", { style: S.detailTags, children: event.tags.map(function (tag) { return (0, react_jsx_runtime.jsx)("span", { style: S.detailTag, children: tag }, tag); }) }) : null,
						event.eventTime ? (0, react_jsx_runtime.jsx)("p", { style: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", margin: "8px 0 0", fontVariantNumeric: "tabular-nums" }, children: event.eventTime }) : null,
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
					normalizedGap,
					gapDirectionText,
					melBand,
					rriBand,
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
