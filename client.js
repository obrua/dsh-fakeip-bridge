/**
 * dsh-fakeip-bridge — browser half.
 *
 * Registers the bundle's configuration form directly on its Plugins-page bundle
 * page (slot `plugins.bundle.config`, keyed by the bundle package name, so the
 * form is visible as soon as the bundle is opened). The form edits the row's
 * volatile Config fields through the shared settings form service: values come
 * from the Host settings document and writes go back through the active
 * profile's Cordis patch, applying live.
 *
 * Hand-authored Client bundle in the module-loader format, so no build step is
 * needed for this linked package.
 */
window.__ModuleLoader__.load({
	id: 'dsh-fakeip-bridge',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		/** Locale namespace owned by this client plugin. */
		const NS = 'fakeipBridge';
		/** Host entry id of the row whose config this page edits. */
		const ENTRY_ID = 'dsh-fakeip-bridge';
		/** Key of the bundle whose page renders this form. */
		const BUNDLE_KEY = 'dsh-fakeip-bridge';

		/** English copy. */
		const en = {
			title: 'Fake-IP bridge configuration',
			ipv4Label: 'fake-IP IPv4 ranges',
			ipv4Hint: 'One CIDR range per line. Default: 198.18.0.0/15.',
			ipv6Label: 'fake-IP IPv6 ranges',
			ipv6Hint: 'One CIDR range per line. Default: 2001:2::/48 and fdfe:dcba:9876::/64.',
			logLabel: 'Log allowed destinations',
			logHint: 'Print each fake-IP destination that the bridge lets through to the Host log.',
			save: 'Save',
			saving: 'Saving…',
			reset: 'Reset to default',
			saved: 'Saved. The next fetch uses the new ranges.',
			resetDone: 'Defaults restored.',
			saveFailed: 'The save was refused. Check the values and try again.',
			invalidRange: 'Invalid range: {value}',
			emptyRange: 'Enter at least one IPv4 range and one IPv6 range.',
			loading: 'Reading configuration…',
			unavailable: 'Configuration is unavailable: the plugin is not loaded or this deployment has no settings form.',
			readOnly: 'Plugin configuration is read-only in this deployment.',
			summary: 'Allowed fake-IP ranges: {ipv4} / {ipv6}',
			none: '(none)',
		};

		/** Simplified Chinese copy. */
		const zh = {
			title: 'Fake-IP 桥接配置',
			ipv4Label: 'fake-IP IPv4 网段',
			ipv4Hint: '每行一个 CIDR 网段。默认：198.18.0.0/15。',
			ipv6Label: 'fake-IP IPv6 网段',
			ipv6Hint: '每行一个 CIDR 网段。默认：2001:2::/48 与 fdfe:dcba:9876::/64。',
			logLabel: '打印放行日志',
			logHint: '开启后会把被放行的 fake-IP 目标地址打印到 Host 日志。',
			save: '保存',
			saving: '保存中…',
			reset: '恢复默认',
			saved: '已保存，下一次抓取立即生效。',
			resetDone: '已恢复默认值。',
			saveFailed: '保存失败，请检查输入或稍后再试。',
			invalidRange: '无效的网段：{value}',
			emptyRange: 'IPv4 与 IPv6 至少各填写一个网段。',
			loading: '正在读取配置…',
			unavailable: '配置不可用：插件未加载，或当前部署没有设置表单。',
			readOnly: '当前部署的插件配置为只读。',
			summary: 'fake-IP 放行网段：{ipv4} / {ipv6}',
			none: '（空）',
		};

		const labelStyle = {
			color: 'var(--dsw-alias-label-primary)',
			fontSize: 13,
			fontWeight: 500,
			lineHeight: 1.5,
		};
		const hintStyle = {
			color: 'var(--dsw-alias-label-secondary)',
			fontSize: 12,
			lineHeight: 1.5,
			margin: 0,
		};
		const fieldStyle = { display: 'grid', gap: 6 };
		const inputStyle = {
			width: '100%',
			minHeight: 66,
			boxSizing: 'border-box',
			resize: 'vertical',
			padding: '8px 10px',
			borderRadius: 8,
			border: '1px solid var(--dsw-alias-border-l1)',
			background: 'var(--dsw-alias-bg-layer-1)',
			color: 'var(--dsw-alias-label-primary)',
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
			fontSize: 12,
			lineHeight: 1.5,
		};
		const primaryButtonStyle = {
			cursor: 'pointer',
			border: 'none',
			borderRadius: 8,
			padding: '6px 14px',
			fontSize: 13,
			fontWeight: 500,
			background: 'var(--dsw-alias-brand-primary)',
			color: '#ffffff',
		};
		const secondaryButtonStyle = {
			cursor: 'pointer',
			borderRadius: 8,
			padding: '6px 14px',
			fontSize: 13,
			background: 'transparent',
			color: 'var(--dsw-alias-label-primary)',
			border: '1px solid var(--dsw-alias-border-l1)',
		};
		const actionsStyle = { display: 'flex', alignItems: 'center', gap: 8 };
		const noticeStyle = { fontSize: 12, lineHeight: 1.5, margin: 0 };

		/** Split a textarea value into trimmed non-empty lines. */
		function splitLines(text) {
			return String(text ?? '').split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
		}

		/** Range-list values are plain arrays; anything else reads as empty. */
		function rangesOf(value) {
			return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
		}

		/** Shape check for one address or CIDR line, covering IPv4 and IPv6. */
		function isRangeLine(line) {
			const slash = line.indexOf('/');
			const address = slash === -1 ? line : line.slice(0, slash);
			const prefix = slash === -1 ? undefined : line.slice(slash + 1);
			if (address.length === 0) return false;
			if (address.includes(':')) {
				if (!/^[0-9a-fA-F:.]+$/.test(address)) return false;
				if (prefix === undefined) return true;
				return /^\d{1,3}$/.test(prefix) && Number(prefix) <= 128;
			}
			const octets = address.split('.');
			if (octets.length !== 4 || !octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
			if (prefix === undefined) return true;
			return /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
		}

		/** Subscribe a component to the shared form snapshot. */
		function useFormSnapshot(form) {
			const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot());
			React.useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form]);
			return snapshot;
		}

		/**
		 * The bundle configuration form: `summary` for a one-liner, `page` for
		 * the editable form with its Save and Reset controls.
		 */
		function ConfigPage(props) {
			const { view, controller, t } = props;
			const snapshot = useFormSnapshot(controller);
			const [draft, setDraft] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState(null);
			const revision = snapshot.revision;
			React.useEffect(() => {
				setDraft(null);
				setNotice(null);
			}, [revision]);

			const value = snapshot.value ?? {};
			const ipv4 = rangesOf(value.ipv4Ranges);
			const ipv6 = rangesOf(value.ipv6Ranges);
			const summary = t('summary', {
				ipv4: ipv4.join(', ') || t('none'),
				ipv6: ipv6.join(', ') || t('none'),
			});

			if (view === 'summary') return h('span', null, summary);
			if (snapshot.status === 'loading' || snapshot.status === 'idle') return h('p', { style: hintStyle }, t('loading'));
			if (snapshot.status === 'unavailable') return h('p', { style: hintStyle }, t('unavailable'));

			const editable = snapshot.writable === true && revision !== undefined;
			const current = draft ?? {
				ipv4: ipv4.join('\n'),
				ipv6: ipv6.join('\n'),
				log: value.log === true,
			};
			const update = (patch) => setDraft({ ...current, ...patch });

			const submit = async (event) => {
				event.preventDefault();
				if (!editable || busy) return;
				const nextIpv4 = splitLines(current.ipv4);
				const nextIpv6 = splitLines(current.ipv6);
				const invalid = [...nextIpv4, ...nextIpv6].find((line) => !isRangeLine(line));
				if (invalid !== undefined) {
					setNotice({ kind: 'error', text: t('invalidRange', { value: invalid }) });
					return;
				}
				if (nextIpv4.length === 0 || nextIpv6.length === 0) {
					setNotice({ kind: 'error', text: t('emptyRange') });
					return;
				}
				setBusy(true);
				setNotice(null);
				const accepted = await controller.mutate([
					{ op: 'set', path: ['ipv4Ranges'], value: nextIpv4 },
					{ op: 'set', path: ['ipv6Ranges'], value: nextIpv6 },
					{ op: 'set', path: ['log'], value: current.log === true },
				], revision);
				setBusy(false);
				setNotice(accepted
					? { kind: 'ok', text: t('saved') }
					: { kind: 'error', text: t('saveFailed') });
			};

			const reset = async () => {
				if (!editable || busy) return;
				setBusy(true);
				setNotice(null);
				const accepted = await controller.mutate([
					{ op: 'unset', path: ['ipv4Ranges'] },
					{ op: 'unset', path: ['ipv6Ranges'] },
					{ op: 'unset', path: ['log'] },
				], revision);
				setBusy(false);
				if (accepted) {
					setDraft(null);
					setNotice({ kind: 'ok', text: t('resetDone') });
				} else {
					setNotice({ kind: 'error', text: t('saveFailed') });
				}
			};

			const disable = !editable || busy;
			return h('form', { onSubmit: submit, style: { display: 'grid', gap: 14 } },
				h('div', { style: fieldStyle },
					h('label', { htmlFor: 'dsh-fakeip-bridge-ipv4', style: labelStyle }, t('ipv4Label')),
					h('textarea', {
						id: 'dsh-fakeip-bridge-ipv4',
						value: current.ipv4,
						disabled: disable,
						rows: 3,
						spellCheck: false,
						placeholder: '198.18.0.0/15',
						style: inputStyle,
						onChange: (event) => update({ ipv4: event.target.value }),
					}),
					h('p', { style: hintStyle }, t('ipv4Hint')),
				),
				h('div', { style: fieldStyle },
					h('label', { htmlFor: 'dsh-fakeip-bridge-ipv6', style: labelStyle }, t('ipv6Label')),
					h('textarea', {
						id: 'dsh-fakeip-bridge-ipv6',
						value: current.ipv6,
						disabled: disable,
						rows: 3,
						spellCheck: false,
						placeholder: '2001:2::/48',
						style: inputStyle,
						onChange: (event) => update({ ipv6: event.target.value }),
					}),
					h('p', { style: hintStyle }, t('ipv6Hint')),
				),
				h('div', { style: fieldStyle },
					h('label', { style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 } },
						h('input', {
							type: 'checkbox',
							checked: current.log === true,
							disabled: disable,
							onChange: (event) => update({ log: event.target.checked }),
						}),
						t('logLabel'),
					),
					h('p', { style: hintStyle }, t('logHint')),
				),
				notice === null ? null : h('p', {
					style: {
						...noticeStyle,
						color: notice.kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)',
					},
					role: notice.kind === 'error' ? 'alert' : 'status',
				}, notice.text),
				h('div', { style: actionsStyle },
					h('button', { type: 'submit', disabled: disable, style: { ...primaryButtonStyle, opacity: disable ? 0.5 : 1 } }, busy ? t('saving') : t('save')),
					h('button', { type: 'button', disabled: disable, style: { ...secondaryButtonStyle, opacity: disable ? 0.5 : 1 }, onClick: reset }, t('reset')),
				),
				snapshot.writable === false ? h('p', { style: hintStyle }, t('readOnly')) : null,
			);
		}

		/** Mount the locale dictionary and the bundle configuration form. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-fakeip-bridge: dictionaries');
			const t = ctx.locale.bind(NS);
			const controller = ctx.configForms.get(ENTRY_ID);
			ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
				name: 'plugins.bundle.config',
				key: BUNDLE_KEY,
				locale: NS,
				inject: () => ({ controller, t }),
			}, ConfigPage))), 'dsh-fakeip-bridge: bundle configuration page');
		}

		return { inject: ['slots', 'locale', 'configForms'], apply };
	},
});
