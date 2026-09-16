// Generated source fragment. Edit this file, then run npm run build:client.
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
