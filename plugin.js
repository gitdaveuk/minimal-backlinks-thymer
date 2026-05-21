class Plugin extends AppPlugin {
  onLoad() {
    // 1. Initialize State Immediately
    this._panelCleanups = new Map();
    this._navHandler = null;
    this._recordHandler = null;
    this._lineHandler = null;
    this._editingLineGuid = null;

    // 2. Native Outliner CSS
    this.ui.injectCSS(`
      .backref-panel {
        border-top: 1px solid var(--color-border, #e2e8f0);
        margin: 40px 40px 80px 40px;
        padding-top: 24px;
      }
      .backref-panel-header {
        display: flex; align-items: center; gap: 8px; margin-bottom: 24px;
        color: var(--color-text-tertiary, #94a3b8); font-size: 11px;
        font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      }
      .backref-list { display: flex; flex-direction: column; gap: 12px; }
      .backref-item { display: flex; flex-direction: column; }
      .backref-item-header { 
        display: flex; align-items: center; gap: 10px; cursor: pointer; 
        padding: 6px 8px; border-radius: 6px; 
      }
      .backref-item-header:hover { background: var(--color-bg-secondary); }
      .backref-chevron { font-size: 10px; transition: transform 0.2s; opacity: 0.4; }
      .backref-item.expanded .backref-chevron { transform: rotate(90deg); }
      .backref-title-link { font-weight: 700; font-size: 14px; color: var(--color-text-primary); cursor: pointer; }
      .backref-portal-content {
        margin-top: 8px; display: none; padding-left: 16px;
        border-left: 1px solid var(--color-border); flex-direction: column;
      }
      .backref-item.expanded .backref-portal-content { display: flex; }

      /* Portal Lines */
      .portal-line { display: flex; align-items: flex-start; gap: 10px; padding: 2px 8px; min-height: 24px; border-radius: 4px; }
      .portal-line:hover { background: var(--color-bg-secondary); }
      
      .portal-editor { flex: 1; outline: none; line-height: 1.6; color: var(--color-text-secondary); font-size: 14px; word-break: break-word; }
      .portal-editor[contenteditable="true"] { color: var(--color-text-primary); }
      
      /* Prefixes: Bullets and Checkboxes */
      .portal-prefix { width: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 4px; }
      .portal-bullet { font-size: 16px; color: var(--color-text-tertiary); line-height: 1; }
      .portal-cb { width: 15px; height: 15px; cursor: pointer; }

      /* Type Styling */
      .type-heading .portal-editor { font-weight: 700; color: var(--color-text-primary); font-size: 1.25em; }
      .type-quote .portal-editor { border-left: 3px solid var(--color-border); padding-left: 12px; font-style: italic; }
      
      .seg-link, .seg-ref { color: var(--color-accent); cursor: pointer; font-weight: 500; }
    `);

    const refresh = () => {
      if (this._editingLineGuid) return;
      for (const p of this.ui.getPanels()) {
        const r = p.getActiveRecord();
        if (r) this._refreshPanel(p, r);
      }
    };

    this._navHandler = this.events.on('panel.navigated', (ev) => this._attachToPanel(ev.panel));
    this._recordHandler = this.events.on('record.updated', refresh, { collection: '*' });
    this._lineHandler = this.events.on('lineitem.updated', refresh, { collection: '*' });
    for (const panel of this.ui.getPanels()) this._attachToPanel(panel);
  }

  onUnload() {
    if (this._navHandler) this.events.off(this._navHandler);
    if (this._recordHandler) this.events.off(this._recordHandler);
    if (this._lineHandler) this.events.off(this._lineHandler);
    if (this._panelCleanups) {
      for (const cleanup of this._panelCleanups.values()) cleanup();
      this._panelCleanups.clear();
    }
  }

  _attachToPanel(panel) {
    if (!this._panelCleanups) return;
    const pid = panel.getId();
    if (this._panelCleanups.has(pid)) this._panelCleanups.get(pid)();
    const record = panel.getActiveRecord();
    const el = panel.getElement();
    if (!record || !el) return;
    const containerEl = el.querySelector('.panel-content-inner, .panel-content, .editor-scroll-container, .page-content') || el;
    const container = document.createElement('div');
    container.className = 'backref-panel';
    container.setAttribute('data-br-guid', record.guid);
    containerEl.appendChild(container);
    this._renderPanel(container, panel, record);
    this._panelCleanups.set(pid, () => { if (container.parentNode) container.parentNode.removeChild(container); });
  }

  _refreshPanel(panel, record) {
    const container = panel.getElement()?.querySelector(`[data-br-guid="${record.guid}"]`);
    if (container) this._renderPanel(container, panel, record);
    else this._attachToPanel(panel);
  }

  _renderPanel(container, panel, record) {
    if (this._editingLineGuid) return;
    const expanded = new Set();
    container.querySelectorAll('.backref-item.expanded').forEach(i => expanded.add(i.getAttribute('data-src-guid')));
    container.innerHTML = `
      <div class="backref-panel-header"><span class="ti ti-link"></span> Linked Mentions <span class="badge"></span></div>
      <div class="backref-list"></div>
    `;
    this._loadBacklinks(record, panel, container.querySelector('.backref-list'), container.querySelector('.badge'), expanded);
  }

  async _loadBacklinks(record, panel, list, badge, expanded) {
    try {
      let refs = [];
      if (typeof record.getBackReferences === 'function') refs = await record.getBackReferences();
      else if (typeof record.getBackreferences === 'function') refs = await record.getBackreferences();

      badge.textContent = `(${refs.length})`;
      if (refs.length === 0) { list.innerHTML = `<div style="opacity:0.5; font-style:italic;">No mentions.</div>`; return; }

      const uniqueRecs = new Map();
      for (const ref of refs) if (ref.record && !uniqueRecs.has(ref.record.guid)) uniqueRecs.set(ref.record.guid, ref.record);

      list.innerHTML = '';
      for (const src of uniqueRecs.values()) {
        const item = document.createElement('div');
        item.className = 'backref-item';
        if (expanded.has(src.guid)) item.classList.add('expanded');
        item.setAttribute('data-src-guid', src.guid);

        const header = document.createElement('div');
        header.className = 'backref-item-header';
        header.innerHTML = `
          <span class="ti ti-chevron-right backref-chevron"></span>
          <span class="ti ${src.getIcon(true) || 'ti-file-text'}" style="opacity:0.6; font-size:14px;"></span>
          <span class="backref-title-link">${this.ui.htmlEscape(src.getName())}</span>
        `;

        const portal = document.createElement('div');
        portal.className = 'backref-portal-content';

        header.querySelector('.backref-title-link').onclick = (e) => {
          e.stopPropagation();
          panel.navigateTo({ type: 'edit_panel', rootId: src.guid, workspaceGuid: this.getWorkspaceGuid() });
        };

        header.onclick = () => {
          if (item.classList.toggle('expanded')) this._renderPortal(src, portal, panel);
        };

        if (expanded.has(src.guid)) this._renderPortal(src, portal, panel);

        item.appendChild(header);
        item.appendChild(portal);
        list.appendChild(item);
      }
    } catch (e) { list.innerHTML = "Error loading."; }
  }

  async _renderPortal(record, container, panel) {
    try {
      const lines = await record.getLineItems(true);
      container.innerHTML = '';
      if (lines.length === 0) return;
      const lineMap = new Map(lines.map(l => [l.guid, l]));

      for (const line of lines) {
        const row = document.createElement('div');
        row.className = `portal-line type-${line.type}`;
        
        // Depth Calculation
        let depth = 0, cur = line.parent_guid;
        while (cur && lineMap.has(cur)) { depth++; cur = lineMap.get(cur).parent_guid; }
        row.style.paddingLeft = `${(depth * 24) + 8}px`;

        // Native Prefix Logic (Tasks vs Bullets vs None)
        const prefix = document.createElement('div');
        prefix.className = 'portal-prefix';
        if (line.type === 'task') {
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.className = 'portal-cb'; cb.checked = line.isTaskCompleted();
          cb.onclick = (e) => { e.stopPropagation(); line.setTaskStatus(cb.checked ? 'done' : 'none'); };
          prefix.appendChild(cb);
        } else if (line.type === 'ulist' || line.type === 'olist') {
          const bull = document.createElement('div');
          bull.className = 'portal-bullet'; bull.textContent = '•';
          prefix.appendChild(bull);
        }
        row.appendChild(prefix);

        const editor = document.createElement('div');
        editor.className = 'portal-editor';
        editor.setAttribute('data-guid', line.guid);
        
        const getRaw = () => (line.segments || []).map(s => typeof s.text === 'string' ? s.text : (s.text?.title || s.text?.link || '')).join('');

        const renderRich = () => {
          editor.innerHTML = '';
          (line.segments || []).forEach(seg => {
            const span = document.createElement('span');
            span.className = `seg-${seg.type}`;
            if (seg.type === 'ref') {
              const r = this.data.getRecord(seg.text.guid);
              span.textContent = seg.text.title || (r ? r.getName() : '[[...]]');
              span.onmousedown = (e) => { e.stopPropagation(); panel.navigateTo({ type: 'edit_panel', rootId: seg.text.guid, workspaceGuid: this.getWorkspaceGuid() }); };
            } else span.textContent = typeof seg.text === 'string' ? seg.text : (seg.text?.title || seg.text?.link || '');
            editor.appendChild(span);
          });
        };

        renderRich();

        // Robust Navigation Helper
        const focusNext = (targetEditor, atStart) => {
          if (!targetEditor) return;
          const targetGuid = targetEditor.getAttribute('data-guid');
          const targetLine = lineMap.get(targetGuid);
          targetEditor.textContent = (targetLine.segments || []).map(s => typeof s.text === 'string' ? s.text : (s.text?.title || s.text?.link || '')).join('');
          targetEditor.contentEditable = 'true';
          this._editingLineGuid = targetGuid;
          targetEditor.focus();
          const range = document.createRange(), sel = window.getSelection();
          range.selectNodeContents(targetEditor);
          range.collapse(atStart);
          sel.removeAllRanges(); sel.addRange(range);
        };

        editor.onmousedown = (e) => {
          if (e.target.classList.contains('seg-link') || e.target.classList.contains('seg-ref')) return;
          if (editor.contentEditable !== 'true') {
            const x = e.clientX, y = e.clientY;
            editor.textContent = getRaw();
            editor.contentEditable = 'true';
            this._editingLineGuid = line.guid;
            editor.focus();
            const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
            if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
          }
        };

        editor.onblur = async () => {
          const val = editor.textContent;
          editor.contentEditable = 'false';
          this._editingLineGuid = null;
          if (val !== getRaw()) await line.setSegments([{ type: 'text', text: val }]);
          renderRich();
        };

        editor.onkeydown = async (e) => {
          const sel = window.getSelection();
          const offset = sel.anchorOffset;

          if (e.key === 'ArrowUp' && offset === 0) {
            e.preventDefault();
            const prev = row.previousElementSibling?.querySelector('.portal-editor');
            if (prev) { editor.blur(); focusNext(prev, false); }
          } else if (e.key === 'ArrowDown' && offset === editor.textContent.length) {
            e.preventDefault();
            const next = row.nextElementSibling?.querySelector('.portal-editor');
            if (next) { editor.blur(); focusNext(next, true); }
          } else if (e.key === 'Enter') {
            e.preventDefault(); editor.blur();
            await record.createLineItem(lineMap.get(line.parent_guid) || null, line, 'text', null, null);
            this._renderPortal(record, container, panel);
          } else if (e.key === 'Backspace' && editor.textContent === '') {
            e.preventDefault();
            const prev = row.previousElementSibling?.querySelector('.portal-editor');
            editor.blur(); await line.delete();
            this._renderPortal(record, container, panel);
            if (prev) focusNext(prev, false);
          }
        };

        row.appendChild(editor);
        container.appendChild(row);
      }
    } catch (e) { container.innerHTML = "Error rendering."; }
  }
}
