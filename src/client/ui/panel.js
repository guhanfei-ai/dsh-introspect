// Generated source fragment. Edit this file, then run npm run build:client.
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
					const [selectedHours, setSelectedHours] = react.useState(DEFAULT_CHART_HOURS);
					const [rangeOpen, setRangeOpen] = react.useState(false);
					const chartWrapRef = react.useRef(null);
					const seenVersionRef = react.useRef(null);
					const requestSeqRef = react.useRef(0);
					const rangeRef = react.useRef(null);

					// 关闭 range 下拉（点击外部时）
					react.useEffect(function () {
						if (!rangeOpen) return;
						function handleClick(e) {
							if (rangeRef.current && !rangeRef.current.contains(e.target)) setRangeOpen(false);
						}
						document.addEventListener("mousedown", handleClick);
						return function () { document.removeEventListener("mousedown", handleClick); };
					}, [rangeOpen]);

					// 刷新：race-safe，latest selection wins
					const refresh = react.useCallback(async function (hoursOverride) {
						if (!face || typeof face.fetchDashboard !== "function") return;
						const hours = typeof hoursOverride === "number" ? hoursOverride : selectedHours;
						const seq = ++requestSeqRef.current;
						setLoading(true);
						try {
							const value = await face.fetchDashboard(sessionId, { hours: hours });
							if (seq !== requestSeqRef.current) return; // stale response, discard
							if (value && value.ok) { setDashboard(value); setError(null); }
						} catch (e) {
							if (seq !== requestSeqRef.current) return;
							if (e) setError(e.message ?? "fetch failed");
						} finally {
							if (seq === requestSeqRef.current) setLoading(false);
						}
					}, [face, sessionId, selectedHours]);

					// fingerprint 变化时：保留当前 selectedHours
					react.useEffect(function () {
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

					react.useEffect(function () {
						if (visible && !dashboard && !loading) refresh();
					}, [visible, dashboard, loading, refresh]);

					// 切换时间范围：立即刷新
					function selectHours(h) {
						setSelectedHours(h);
						setRangeOpen(false);
						setChartHover(null);
						refresh(h);
					}

					const openDetail = react.useCallback(async function (id) {
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

					const closeDetail = react.useCallback(function () {
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
								onClick: function () { face.setDraft("记录一下："); },
								children: "＋ Record",
							}) : null,
						] });
					}

					// 从 dashboard metadata 构建 timeWindow
					var timeWindow = makeTimeWindow(dashboard.hours, dashboard.generatedAt);
					var chart = buildChartPaths(dashboard.series, 300, 160, timeWindow);
					var normGap = dashboard.normalizedGap;
					var lastTime = dashboard.today.lastEventTime;
					var lastClock = lastTime ? localClock(lastTime) : null;

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
										onClick: function () { refresh(); },
										onMouseEnter: function () { setRefreshHover(true); },
										onMouseLeave: function () { setRefreshHover(false); },
										children: loading ? "…" : "↻",
									}),
								] }),
							] }),
							(0, react_jsx_runtime.jsx)(HeroMetrics, { today: dashboard.today }),
							normGap !== null ? (0, react_jsx_runtime.jsxs)("div", { style: S.gapStrip, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.gapLabel, children: "GAP" }),
								(0, react_jsx_runtime.jsx)("span", { style: S.gapValue, children: signed(normGap) }),
								(0, react_jsx_runtime.jsx)("span", { style: S.gapDirection, children: gapDirectionText(normGap) }),
							] }) : null,
						] }),
						(0, react_jsx_runtime.jsx)(SecondaryRail, { today: dashboard.today }),
						// ── Chart ──
						(0, react_jsx_runtime.jsxs)("div", {
							style: S.chartWrap,
							ref: chartWrapRef,
							children: [
								(0, react_jsx_runtime.jsxs)("div", { style: S.chartHeader, children: [
									(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }, children: [
										(0, react_jsx_runtime.jsxs)("span", { style: S.chartRange, children: ["Last ", selectedHours, "h", dashboard.seriesTruncated ? " · " + dashboard.seriesReturned + " obs" : dashboard.series.length > 0 ? " · " + dashboard.series.length + " obs" : ""] }),
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
									// ── Range selector ──
									(0, react_jsx_runtime.jsxs)("div", { style: S.rangeSelect, ref: rangeRef, children: [
										(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: rangeOpen ? { ...S.rangeButton, ...S.rangeButtonHover } : S.rangeButton,
											onClick: function () { setRangeOpen(function (v) { return !v; }); },
											children: formatHoursLabel(selectedHours) + " ▾",
										}),
										rangeOpen ? (0, react_jsx_runtime.jsx)("div", { style: S.rangeMenu, children: CHART_HOURS_OPTIONS.map(function (h) {
											var isActive = h === selectedHours;
											return (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: isActive ? { ...S.rangeOption, ...S.rangeOptionActive } : S.rangeOption,
												onClick: function () { selectHours(h); },
												onMouseEnter: function (e) { if (!isActive) e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover)"; },
												onMouseLeave: function (e) { if (!isActive) e.currentTarget.style.background = "none"; },
												children: formatHoursLabel(h),
											}, h);
										}) }) : null,
									] }),
								] }),
								chart.empty ? (0, react_jsx_runtime.jsxs)("div", { children: [
									(0, react_jsx_runtime.jsx)(MelRriChart, {
										chart: chart,
										hoverIndex: chartHover ? chartHover.index : null,
										onHover: setChartHover,
										onLeave: function () { setChartHover(null); },
									}),
									(0, react_jsx_runtime.jsx)("div", { style: { textAlign: "center", padding: "8px 0 0", fontSize: "10px", color: "var(--dsw-alias-label-caption)" }, children: "No observations in this window" }),
								] }) : (0, react_jsx_runtime.jsxs)("div", { children: [
									(0, react_jsx_runtime.jsx)(MelRriChart, {
										chart: chart,
										hoverIndex: chartHover ? chartHover.index : null,
										onHover: setChartHover,
										onLeave: function () { setChartHover(null); },
									}),
									chartHover ? (0, react_jsx_runtime.jsx)(ChartTooltip, { hover: chartHover, chart: chart, containerRef: chartWrapRef }) : null,
								] }),
							],
						}),
						// ── Today Strip ──
						(0, react_jsx_runtime.jsxs)("div", { style: S.todayStrip, children: [
							(0, react_jsx_runtime.jsxs)("div", { style: S.todayLeft, children: [
								(0, react_jsx_runtime.jsx)("span", { style: S.todayLabel, children: "TODAY" }),
								(0, react_jsx_runtime.jsxs)("span", { style: S.todayInfo, children: [
									dashboard.today.count,
									" event",
									dashboard.today.count !== 1 ? "s" : "",
									lastClock ? " · last " + lastClock : "",
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
					if (!chart) return null;

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
					if (containerRect && left > containerRect.width - 140) left = left - 152;
					if (top < 0) top = 8;
					return (0, react_jsx_runtime.jsxs)("div", {
						style: { ...S.tooltip, left: left + "px", top: top + "px" },
						children: [
							(0, react_jsx_runtime.jsx)("div", { style: S.tooltipTime, children: d.time ? localTimeFull(d.time) : "" }),
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
