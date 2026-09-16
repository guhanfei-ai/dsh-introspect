// Generated source fragment. Edit this file, then run npm run build:client.
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
