// Generated source fragment. Edit this file, then run npm run build:client.
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
