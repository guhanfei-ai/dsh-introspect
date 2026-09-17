// Generated source fragment. Edit this file, then run npm run build:client.
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
