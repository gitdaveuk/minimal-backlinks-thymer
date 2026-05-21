class Plugin extends AppPlugin {
  onLoad() {
    // 1. INITIALIZE EVERYTHING FIRST - This prevents the "values" error
    this._panelCleanups = new Map();
    this._navHandler = null;
    this._recordHandler = null;
    this._lineHandler = null;
    this._collectionCache = null;

    // 2. Inject CSS
    this.ui.injectCSS(`
      .backref-panel {
        border-top: 1px solid var(--color-border, #e2e8f0);
        margin: 40px 40px 64px 40px;
        padding-top: 24px;
        font-size: 13px;
        background: transparent;
      }

      .backref-panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 20px;
        color: var(--color-text-tertiary, #94a3b8);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .backref-list {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .backref-item {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .backref-item-top {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
      }

      .backref-chevron {
        font-size: 10px;
        transition: transform 0.2s;
        opacity: 0.5;
      }

      .backref-item.expanded .backref-chevron {
        transform: rotate(90deg);
      }

      .backref-item-title {
        font-weight: 600;
        color: var(--color-text-primary);
        font-size: 13.5px;
      }

      .backref-item-title:hover {
        color: var(--color-accent, #6366f1);
        text-decoration: underline;
      }

      /* Transclusion Area */
      .backref-transclusion {
        margin-left: 24px;
        padding-left: 16px;
        border-left: 2px solid var(--color-border, #e2e8f0);
        display: none;
        flex-direction: column;
        gap: 4px;
      }

      .backref-item.expanded .backref-transclusion {
        display: flex;
      }

      .trans-line {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 2px 4px;
        border-radius: 4px;
        min-height: 20px;
        transition: background 0.1s;
      }

      .trans-line:hover {
        background: var(--color-bg-secondary, #f1f5f9);
      }

      .trans-line-content {
        flex: 1;
        outline: none;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--color-text-secondary);
        font-size: 13px;
      }

      .trans-line-content[contenteditable="true"] {
        color: var(--color-text-primary);
        background: var(--color-bg-primary);
        box-shadow: 0 0 0 2px var(--color-accent);
      }

      .trans-checkbox {
        width: 14px;
        height: 14px;
        margin-top: 3px;
        cursor: pointer;
      }

      .trans-line.type-heading .trans-line-content {
        font-weight: 700;
        color: var(--color-text-primary);
      }

      @keyframes br-spin { to { transform: rotate(360deg); } }
      .br-spin { display: inline-block; animation: br-spin 1s linear infinite; }
    `);

    // 3. Setup logic
    const setupAll = () => {
      for (const panel of this.ui.getPanels()) this._attachToPanel(panel);
    };
    setupAll();

    this._navHandler = this.events.on('panel.navigated', (ev) => this._attachToPanel(ev.panel));
    
    const refresh = () => {
      for (const p of this.ui.getPanels()) {
        const r = p.getActiveRecord();
        if (r) this._refreshPanel(p, r);
      }
    };
    this._recordHandler = this.events.on('record.updated', refresh, { collection: '*' });
    this._lineHandler = this.events.on('lineitem.updated', refresh, { collection: '*' });
  }

  onUnload() {
    // DEFENSIVE CLEANUP: Check if variables exist before using them
    if (this._navHandler) this.events.off(this._navHandler);
    if (this._recordHandler) this.events.off(this._recordHandler);
    if (this._lineHandler) this.events.off(this._lineHandler);
    
    if (this._panelCleanups) {
      for (const cleanup of this._panelCleanups.values()) {
        if (typeof cleanup === 'function') cleanup();
      }
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

    this._panelCleanups.set(pid, () => {
      if (container.parentNode) container.parentNode.removeChild(container);
    });
  }

  _refreshPanel(panel, record) {
    const el = panel.getElement();
    if (!el) return;
    const container = el.querySelector(`[data-br-guid="${record.guid}"]`);
    if (container) this._renderPanel(container, panel, record);
    else this._attachToPanel(panel);
  }

  _renderPanel(container, panel, record) {
    container.innerHTML = `
      <div class="backref-panel-header">
        <span class="ti ti-link"></span>
        <span>Linked mentions <span class="backref-count-badge"></span></span>
      </div>
      <div class="backref-list"></div>
    `;

    this._loadData(record, panel, container.querySelector('.backref-list'), container.querySelector('.backref-count-badge'));
  }

  async _loadData(record, panel, list, badge) {
    try {
      let refs = [];
      if (typeof record.getBackReferences === 'function') {
        refs = await record.getBackReferences();
      } else if (typeof record.getBackReferenceRecords === 'function') {
        const recs = await record.getBackReferenceRecords();
        refs = recs.map(r => ({ record: r, kind: 'line' }));
      }

      badge.textContent = `(${refs.length})`;
      
      if (refs.length === 0) {
        list.innerHTML = `<div style="color:var(--color-text-tertiary); font-style:italic;">No mentions.</div>`;
        return;
      }

      const uniqueRecs = new Map();
      for (const ref of refs) {
        if (ref.record && !uniqueRecs.has(ref.record.guid)) uniqueRecs.set(ref.record.guid, ref.record);
      }

      list.innerHTML = '';
      for (const srcRecord of uniqueRecs.values()) {
        const item = document.createElement('div');
        item.className = 'backref-item';
        
        const icon = srcRecord.getIcon(true) || 'ti-file-text';
        
        item.innerHTML = `
          <div class="backref-item-top">
            <span class="ti ti-chevron-right backref-chevron"></span>
            <span class="ti ${icon}" style="opacity:0.5; font-size:14px;"></span>
            <span class="backref-item-title">${this.ui.htmlEscape(srcRecord.getName())}</span>
          </div>
          <div class="backref-transclusion">
            <div style="padding:10px; opacity:0.5;"><span class="ti ti-loader br-spin"></span> Loading content...</div>
          </div>
        `;

        item.querySelector('.backref-item-title').onclick = (e) => {
          e.stopPropagation();
          panel.navigateTo({ type: 'edit_panel', rootId: srcRecord.guid, workspaceGuid: this.getWorkspaceGuid() });
        };

        item.querySelector('.backref-item-top').onclick = () => {
          const isExpanded = item.classList.toggle('expanded');
          if (isExpanded) this._renderTransclusion(srcRecord, item.querySelector('.backref-transclusion'));
        };

        list.appendChild(item);
      }
    } catch (e) {
      list.innerHTML = `Error loading backlinks.`;
    }
  }

  async _renderTransclusion(record, container) {
    try {
      const lines = await record.getLineItems(true);
      container.innerHTML = '';

      if (lines.length === 0) {
        container.innerHTML = `<div style="padding:10px; opacity:0.5;">Note is empty.</div>`;
        return;
      }

      for (const line of lines) {
        const lineEl = document.createElement('div');
        lineEl.className = `trans-line type-${line.type}`;
        
        if (line.type === 'task') {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'trans-checkbox';
          cb.checked = line.isTaskCompleted() === true;
          cb.onclick = async (e) => {
            e.stopPropagation();
            await line.setTaskStatus(cb.checked ? 'done' : 'none');
          };
          lineEl.appendChild(cb);
        }

        const content = document.createElement('div');
        content.className = 'trans-line-content';
        const rawText = (line.segments || []).map(s => typeof s.text === 'string' ? s.text : (s.text?.title || '')).join('');
        content.textContent = rawText;

        content.onclick = (e) => {
          e.stopPropagation();
          content.contentEditable = "true";
          content.focus();
        };

        content.onblur = async () => {
          content.contentEditable = "false";
          const newText = content.textContent;
          if (newText !== rawText) {
            await line.setSegments([{ type: 'text', text: newText }]);
          }
        };

        content.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            content.blur();
          }
        };

        lineEl.appendChild(content);
        container.appendChild(lineEl);
      }
    } catch (e) {
      container.innerHTML = `Error loading content.`;
    }
  }
}
