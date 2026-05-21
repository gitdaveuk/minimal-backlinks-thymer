class Plugin extends AppPlugin {
  onLoad() {
    this._panelCleanups = new Map();
    this._navHandler = null;
    this._recordHandler = null;
    this._lineHandler = null;
    this._editingLineGuid = null;

    this.ui.injectCSS(`
      .backref-panel {
        border-top: 1px solid var(--color-border, #e2e8f0);
        margin: 40px 0 80px 0; /* Align to left/right margins of the note */
        padding-top: 24px;
      }
      .backref-panel-header {
        display: flex; align-items: center; gap: 8px; margin-bottom: 24px;
        color: var(--color-text-tertiary, #94a3b8); font-size: 11px;
        font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      }
      .backref-list { display: flex; flex-direction: column; gap: 16px; }
      .backref-item { display: flex; flex-direction: column; }
      .backref-item-header { 
        display: flex; align-items: center; gap: 10px; cursor: pointer; 
        padding: 6px 0px; border-radius: 6px; 
      }
      .backref-item-header:hover { opacity: 0.8; }
      .backref-chevron { font-size: 10px; transition: transform 0.2s; opacity: 0.4; }
      .backref-item.expanded .backref-chevron { transform: rotate(90deg); }
      .backref-title-link { font-weight: 700; font-size: 14px; color: var(--color-text-primary); cursor: pointer; }
      
      .backref-portal-content {
        margin-top: 8px; display: none; padding-left: 12px;
        border-left: 1px solid var(--color-border); flex-direction: column;
      }
      .backref-item.expanded .backref-portal-content { display: flex; }

      .portal-line-wrapper { display: flex; flex-direction: column; }
      .portal-line-row { display: flex; align-items: flex-start; gap: 10px; padding: 2px 8px; min-height: 24px; border-radius: 4px; }
      .portal-line-row:hover { background: var(--color-bg-secondary); }
      
      .portal-prefix { width: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 4px; }
      .portal-bullet { font-size: 16px; color: var(--color-text-tertiary); line-height: 1; }
      .portal-cb { width: 15px; height: 15px; cursor: pointer; }

      .portal-editor { flex: 1; outline: none; line-height: 1.6; color: var(--color-text-secondary); font-size: 14px; word-break: break-word; }
      .portal-editor[contenteditable="true"] { color: var(--color-text-primary); }
      
      .portal-children { padding-left: 24px; }

      .seg-link, .seg-ref, .seg-datetime { color: var(--color-accent, #6366f1); cursor: pointer; font-weight: 500; }
      .seg-datetime { background: rgba(99, 102, 241, 0.08); padding: 0 6px; border-radius: 10px; border: 1px solid rgba(99, 102, 241, 0.2); font-size: 0.95em; }
      .type-heading .portal-editor { font-weight: 700; color: var(--color-text-primary); font-size: 1.25em; }
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
      
      // Removed the "No mentions" placeholder as requested
      if (refs.length === 0) return;

      const uniqueRecs = new Map();
      for (const ref of refs) if (ref.record && !uniqueRecs.has(ref.record.guid)) uniqueRecs.set(ref.record.guid, ref.record);

      for (const src of uniqueRecs.values()) {
        const item = document.createElement('div');
        item.className = 'backref-item';
        if (expanded.has(src.guid)) item.classList.add('expanded');
        item.setAttribute('data-src-guid', src.guid);

        const header = document.createElement('div');
        header.className = 'backref-item-header';
        header.innerHTML = `<span class="ti ti-chevron-right backref-chevron"></span><span class="ti ${src.getIcon(true) || 'ti-file-text'}" style="opacity:0.6; font-size:14px;"></span><span class="backref-title-link">${this.ui.htmlEscape(src.getName())}</span>`;
        
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

        item.appendChild(header); item.appendChild(portal); list.appendChild(item);
      }
    } catch (e) { console.error(e); }
  }

  async _renderPortal(record, container, panel) {
    try {
      const lines = await record.getLineItems(true);
      container.innerHTML = '';
      if (lines.length === 0) return;

      const lineMap = new Map(lines.map(l => [l.guid, l]));
      const roots = lines.filter(l => !l.parent_guid || !lineMap.has(l.parent_guid));

      const focusEditorIndex = (idx, atStart) => {
          const editors = Array.from(container.querySelectorAll('.portal-editor'));
          const target = editors[idx];
          if (!target) return;
          const targetGuid = target.getAttribute('data-guid');
          const targetLine = lineMap.get(targetGuid);
          
          target.textContent = (targetLine.segments || []).map(s => {
              if (typeof s.text === 'string') return s.text;
              if (s.type === 'datetime') return '@' + new DateTime(s.text).toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              return (s.text?.title || '');
          }).join('');

          target.contentEditable = 'true';
          this._editingLineGuid = targetGuid;
          target.focus();
          
          const range = document.createRange(), sel = window.getSelection();
          range.selectNodeContents(target);
          range.collapse(atStart);
          sel.removeAllRanges(); sel.addRange(range);
      };

      const renderNode = (line, targetContainer) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'portal-line-wrapper';
        
        const row = document.createElement('div');
        row.className = `portal-line-row type-${line.type}`;

        const prefix = document.createElement('div');
        prefix.className = 'portal-prefix';
        if (line.type === 'task') {
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.className = 'portal-cb'; cb.checked = line.isTaskCompleted();
          cb.onclick = (e) => { e.stopPropagation(); line.setTaskStatus(cb.checked ? 'done' : 'none'); };
          prefix.appendChild(cb);
        } else if (line.type === 'ulist' || line.type === 'olist') {
          prefix.innerHTML = '<div class="portal-bullet">•</div>';
        }
        row.appendChild(prefix);

        const editor = document.createElement('div');
        editor.className = 'portal-editor';
        editor.setAttribute('data-guid', line.guid);
        
        const getRaw = () => (line.segments || []).map(s => {
            if (typeof s.text === 'string') return s.text;
            if (s.type === 'datetime') {
                try { return '@' + new DateTime(s.text).toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
                catch(e) { return '@date'; }
            }
            return (s.text?.title || s.text?.link || '');
        }).join('');

        const renderRich = () => {
          editor.innerHTML = '';
          (line.segments || []).forEach(seg => {
            const span = document.createElement('span');
            span.className = `seg-${seg.type}`;
            if (seg.type === 'datetime') {
                try {
                    const dtObj = new DateTime(seg.text);
                    span.textContent = '@' + dtObj.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    span.onmousedown = (e) => {
                        e.stopPropagation();
                        const user = this.data.getActiveUsers()[0];
                        if (user) panel.navigateToJournal(user, dtObj);
                    };
                } catch(e) { span.textContent = '@date'; }
            } else if (seg.type === 'ref') {
              const r = this.data.getRecord(seg.text.guid);
              span.textContent = seg.text.title || (r ? r.getName() : '[[...]]');
              span.onmousedown = (e) => { e.stopPropagation(); panel.navigateTo({ type: 'edit_panel', rootId: seg.text.guid, workspaceGuid: this.getWorkspaceGuid() }); };
            } else span.textContent = typeof seg.text === 'string' ? seg.text : (seg.text?.title || seg.text?.link || '');
            editor.appendChild(span);
          });
        };

        renderRich();

        editor.onmousedown = (e) => {
          if (e.target.classList.contains('seg-link') || e.target.classList.contains('seg-ref') || e.target.classList.contains('seg-datetime')) return;
          if (editor.contentEditable !== 'true') {
            const x = e.clientX, y = e.clientY;
            editor.textContent = getRaw();
            editor.contentEditable = 'true';
            this._editingLineGuid = line.guid;
            editor.focus();
            let range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
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
            const editors = Array.from(container.querySelectorAll('.portal-editor'));
            const currentIdx = editors.indexOf(editor);

            if (e.key === 'ArrowUp' && offset === 0) {
                e.preventDefault();
                if (currentIdx > 0) { editor.blur(); focusEditorIndex(currentIdx - 1, false); }
            } else if (e.key === 'ArrowDown' && offset === editor.textContent.length) {
                e.preventDefault();
                if (currentIdx < editors.length - 1) { editor.blur(); focusEditorIndex(currentIdx + 1, true); }
            } else if (e.key === 'Enter') {
                e.preventDefault(); editor.blur();
                await record.createLineItem(lineMap.get(line.parent_guid) || null, line, 'text', null, null);
                await this._renderPortal(record, container, panel);
                focusEditorIndex(currentIdx + 1, true);
            } else if (e.key === 'Backspace' && editor.textContent === '') {
                e.preventDefault(); editor.blur();
                await line.delete();
                await this._renderPortal(record, container, panel);
                if (currentIdx > 0) focusEditorIndex(currentIdx - 1, false);
            }
        };

        row.appendChild(editor);
        wrapper.appendChild(row);

        const children = lines.filter(l => l.parent_guid === line.guid);
        if (children.length > 0) {
            const childCont = document.createElement('div');
            childCont.className = 'portal-children';
            children.forEach(c => renderNode(c, childCont));
            wrapper.appendChild(childCont);
        }
        targetContainer.appendChild(wrapper);
      };

      roots.forEach(r => renderNode(r, container));
    } catch (e) { container.innerHTML = "Error."; }
  }
}
