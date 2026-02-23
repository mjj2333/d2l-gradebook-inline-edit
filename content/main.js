(function() {
    'use strict';

    const spreadsheetModeInput = document.querySelector('input[name="SpreadsheetMode"]');
    if (spreadsheetModeInput && spreadsheetModeInput.value === 'true') {
        console.log('[D2L InlineEdit] Spreadsheet View detected. Script is for Standard View. Aborting.');
        return;
    }

    console.log('[D2L InlineEdit] Standard View detected. Initializing script.');

    const gridTable = document.querySelector('table.d2l-grid.d_gd');
    if (!gridTable) { console.log('[D2L InlineEdit] Grid table not found. Aborting.'); return; }

    const wrapper = document.querySelector('d2l-table-wrapper');
    if (!wrapper) { console.log('[D2L InlineEdit] d2l-table-wrapper not found. Aborting.'); return; }

    // FIX v8.9: The custom element may not have initialized its shadow root yet
    // at document-end. Wait for the element to upgrade, then poll up to 3s.
    function waitForShadowRoot(callback) {
        const tryGet = (attemptsLeft) => {
            if (wrapper.shadowRoot) {
                console.log('[D2L InlineEdit] Shadow root ready.');
                callback(wrapper.shadowRoot);
            } else if (attemptsLeft > 0) {
                setTimeout(() => tryGet(attemptsLeft - 1), 100);
            } else {
                console.log('[D2L InlineEdit] Shadow root never appeared after 3s. Aborting.');
            }
        };
        // Poll directly — customElements API not reliable in extension content scripts
        tryGet(30);
    }

    waitForShadowRoot(init);

    function init(shadowRoot) {

        const pendingChanges = new Map();
        const columnIdMap   = new Map();
        const editableCells = new Set();

        function extractReferrer() {
            return document.querySelector('input[name="d2l_referrer"]')?.value || '';
        }

        function createSaveButtons() {
            const buttonsHtml = `
                <div id="inline-edit-controls" style="position:fixed;top:10px;right:10px;z-index:10000;background:#f8f9fa;padding:12px 16px;border-radius:6px;border:2px solid #dee2e6;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                    <button type="button" id="inline_save_btn" style="margin-right:8px;background:#006fbf;color:white;border:none;padding:8px 16px;border-radius:4px;font-weight:500;cursor:pointer;">Save Changes</button>
                    <button type="button" id="inline_cancel_btn" style="margin-right:8px;background:#6c757d;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
                    <div style="font-size:14px;color:#495057;margin-top:4px;"><span id="changes_indicator">No pending changes</span></div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', buttonsHtml);
            document.getElementById('inline_save_btn').addEventListener('click', handleSave);
            document.getElementById('inline_cancel_btn').addEventListener('click', handleCancel);
        }

        function updateButtonsVisibility() {
            const container = document.getElementById('inline-edit-controls');
            if (!container) return;
            const indicator = document.getElementById('changes_indicator');
            if (pendingChanges.size > 0) {
                indicator.textContent = `${pendingChanges.size} pending change(s)`;
                container.style.background = '#fff3cd';
                container.style.borderColor = '#ffc107';
                container.style.display = 'block';
                if (!document.getElementById('inline-edit-pulse-style')) {
                    const style = document.createElement('style');
                    style.id = 'inline-edit-pulse-style';
                    style.textContent = `@keyframes pulse{0%,100%{box-shadow:0 4px 12px rgba(0,0,0,0.15)}50%{box-shadow:0 4px 12px rgba(255,193,7,0.4)}}`;
                    document.head.appendChild(style);
                }
                container.style.animation = 'pulse 2s infinite';
            } else {
                container.style.display = 'none';
                container.style.animation = 'none';
            }
        }

        function updateVisualText(cell, newText) {
            const link = cell.querySelector('a.d2l-link.d2l-link-inline');
            if (link) { link.textContent = newText; return; }
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.trim().length > 0) { node.textContent = newText; return; }
            }
        }

        async function performRpcSave() {
            const rpcUrl = window.location.href.replace('.d2l?', '.d2lfile?').replace(/&d2l_change=\d+/, '') + '&d2l_change=1&d2l_rh=rpc&d2l_rt=call';
            const d2l_referrer = extractReferrer();
            const d2l_hitcode_base = document.querySelector('input[name="d2l_hitCode"]').value;
            let hitcodeOffset = 0;

            for (const change of pendingChanges.values()) {
                let saveParams;
                if (change.gradeType === 'final_adjusted') {
                    const { userId, itemId, newNumerator, newDenominator, oldNumerator, oldDenominator } = change;
                    const numName = `${userId}_${itemId}_Numerator`, denName = `${userId}_${itemId}_Denominator`, statName = `${userId}_${itemId}_Status`;
                    saveParams = { param1: 0, param2: [numName, denName, statName], param3: [String(newNumerator), String(newDenominator), "0"], param4: [numName, denName, statName], param5: [String(oldNumerator), String(oldDenominator), "0"] };
                } else if (change.type === 'fraction') {
                    const numName = `${change.userId}_${change.itemId}_Numerator`;
                    saveParams = { param1: 0, param2: [numName], param3: [String(change.newNumerator)], param4: [numName], param5: [String(change.oldNumerator)] };
                } else {
                    saveParams = { param1: 0, param2: [change.fieldName], param3: [String(change.newNumerator)], param4: [change.fieldName], param5: [String(change.oldNumerator)] };
                }
                const saveBody = new URLSearchParams({ d2l_rf: 'Save', params: JSON.stringify(saveParams), d2l_referrer, d2l_hitcode: (parseInt(d2l_hitcode_base, 10) + hitcodeOffset).toString(), d2l_action: 'rpc' });
                hitcodeOffset++;
                const res = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: saveBody.toString() });
                if (!res.ok) throw new Error(`Save RPC failed: ${res.status}`);
                const text = (await res.text()).replace(/^while\(true\)\{\}/, '');
                if (text) {
                    const json = JSON.parse(text);
                    if (json.MessageArea?.Errors?.length > 0) throw new Error(`RPC errors: ${JSON.stringify(json.MessageArea.Errors)}`);
                }
            }
            const recalcBody = new URLSearchParams({ d2l_rf: 'RecalculateAllUsers', params: '{}', d2l_referrer, d2l_hitcode: (parseInt(d2l_hitcode_base, 10) + hitcodeOffset).toString(), d2l_action: 'rpc' });
            await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: recalcBody.toString() });
        }

        async function handleSave(event) {
            event.preventDefault();
            const btn = document.getElementById('inline_save_btn');
            btn.textContent = 'Saving...'; btn.disabled = true;
            try {
                await performRpcSave();
                btn.textContent = 'Saved! Reloading...'; btn.style.background = '#28a745';
                setTimeout(() => window.location.reload(), 1000);
            } catch (err) {
                console.error('[D2L InlineEdit] Save error:', err);
                alert(`Save error: ${err.message}`);
                btn.textContent = 'Save Changes'; btn.disabled = false; btn.style.background = '#006fbf';
            }
        }

        function handleCancel(event) {
            event.preventDefault();
            if (!confirm('Cancel all pending changes?')) return;
            pendingChanges.forEach(c => { updateVisualText(c.cell, c.originalText); c.cell.style.background = ''; c.cell.style.border = ''; c.cell.title = ''; });
            pendingChanges.clear();
            updateButtonsVisibility();
        }

        function handleFractionEdit(cell, originalText, fracMatch) {
            const row = cell.closest('tr');
            const userId = row.querySelector('a[onclick*=gotoGradeUserGroupSectionFilter]')?.getAttribute('onclick').match(/gotoGradeUserGroupSectionFilter\(\s*(\d+)/)?.[1];
            const columnInfo = columnIdMap.get(cell.cellIndex);
            const itemId    = columnInfo?.id;
            const gradeType = columnInfo?.type || 'fraction';
            if (!userId || !itemId) { console.warn('[D2L InlineEdit] Could not resolve userId/itemId', { cellIndex: cell.cellIndex }); return; }

            const [, oldNumStr, oldDenomStr] = fracMatch;
            const originalContent = cell.innerHTML;
            const originalCssText = cell.style.cssText; // save full inline style

            const container = document.createElement('div');
            container.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:20px;padding:2px;';

            const makeInput = val => {
                const inp = document.createElement('input');
                inp.type = 'text'; inp.value = val === '-' ? '' : val;
                inp.style.cssText = 'width:40px;padding:1px 2px;border:2px solid #007cba;border-radius:3px;font-size:14px;text-align:center;margin:0 2px;';
                return inp;
            };

            const numInput = makeInput(oldNumStr);
            container.appendChild(numInput);
            container.appendChild(document.createTextNode(' / '));
            let denInput = null;
            if (gradeType === 'final_adjusted') { denInput = makeInput(oldDenomStr); container.appendChild(denInput); }
            else { container.appendChild(document.createTextNode(oldDenomStr)); }

            cell.innerHTML = ''; cell.appendChild(container);
            cell.style.cssText = 'background:#f0f8ff;border:2px solid #007cba;';
            numInput.focus(); numInput.select();

            const saveEdit = () => {
                const newNum = numInput.value.trim(), newDen = denInput ? denInput.value.trim() : oldDenomStr;
                cell.innerHTML = originalContent; cell.style.cssText = originalCssText;
                if (newNum === oldNumStr && (!denInput || newDen === oldDenomStr)) return;
                const finalNewNum = newNum || '', finalOldNum = oldNumStr === '-' ? '' : oldNumStr;
                const finalNewDen = newDen || '', finalOldDen = oldDenomStr === '-' ? '' : oldDenomStr;
                const visual = `${finalNewNum || '-'} / ${finalNewDen || '-'}`;
                updateVisualText(cell, visual);
                cell.style.background = '#fff3cd'; cell.style.border = '2px solid #ffc107';
                cell.title = `Pending: ${originalText} → ${visual}`;
                pendingChanges.set(`${userId}_${itemId}`, { cell, userId, itemId, gradeType, originalText, type: 'fraction', oldNumerator: finalOldNum, newNumerator: finalNewNum, oldDenominator: finalOldDen, newDenominator: finalNewDen });
                updateButtonsVisibility();
            };
            const cancelEdit = () => { cell.innerHTML = originalContent; cell.style.cssText = originalCssText; };
            const onBlur = () => setTimeout(() => { if (!container.contains(document.activeElement)) saveEdit(); }, 100);
            [numInput, denInput].forEach(inp => {
                if (!inp) return;
                inp.addEventListener('blur', onBlur);
                inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } });
                inp.addEventListener('dblclick', e => e.stopPropagation());
            });
        }

        function handleTextEdit(cell, originalText) {
            const proficiencyPattern = /^(A|B|C|D|F|P|NP|E|S|N|M|I|Beginning|Developing|Proficient|Exemplary)$/i;
            if (proficiencyPattern.test(originalText)) return;
            const row = cell.closest('tr');
            const userId = row.querySelector('a[onclick*=gotoGradeUserGroupSectionFilter]')?.getAttribute('onclick').match(/gotoGradeUserGroupSectionFilter\(\s*(\d+)/)?.[1];
            const itemId = columnIdMap.get(cell.cellIndex)?.id;
            if (!userId || !itemId) return;
            const oldValue = originalText === '-' ? '' : originalText;
            const inp = document.createElement('input');
            inp.type = 'text'; inp.value = oldValue;
            inp.style.cssText = 'width:90%;padding:4px 6px;border:2px solid #007cba;border-radius:3px;font-size:14px;text-align:center;';
            const originalContent = cell.innerHTML;
            const originalCssText = cell.style.cssText; // save full inline style
            cell.innerHTML = ''; cell.appendChild(inp);
            cell.style.background = '#f0f8ff'; cell.style.border = '2px solid #007cba';
            inp.focus(); inp.select();
            const saveEdit = () => {
                const newText = inp.value.trim();
                cell.innerHTML = originalContent; cell.style.cssText = originalCssText;
                if (newText === oldValue) return;
                updateVisualText(cell, newText || '-');
                cell.style.background = '#fff3cd'; cell.style.border = '2px solid #ffc107';
                cell.title = `Pending: ${originalText} → ${newText || '(empty)'}`;
                pendingChanges.set(`${userId}_${itemId}`, { cell, userId, itemId, originalText, type: 'text', gradeType: 'text', oldNumerator: oldValue, newNumerator: newText, fieldName: `${userId}_${itemId}_GradeText` });
                updateButtonsVisibility();
            };
            const cancelEdit = () => { cell.innerHTML = originalContent; cell.style.cssText = originalCssText; };
            inp.addEventListener('blur', saveEdit);
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } });
            inp.addEventListener('dblclick', e => e.stopPropagation());
        }

        function mapColumnIds() {
            const headerRows = gridTable.querySelectorAll('thead > tr.d_gh');
            if (!headerRows.length) { console.warn('[D2L InlineEdit] No header rows found in thead.'); return; }
            const grid = [];
            headerRows.forEach((row, rowIndex) => {
                let colIndex = 0;
                Array.from(row.cells).forEach(cell => {
                    while (grid[rowIndex]?.[colIndex]) colIndex++;
                    const sortBtn   = cell.querySelector('d2l-table-col-sort-button[data-fieldname]');
                    const fieldname = sortBtn?.dataset?.fieldname;
                    if (fieldname?.startsWith('go_')) {
                        columnIdMap.set(colIndex, { id: fieldname.slice(3), type: cell.innerText.includes('Final Adjusted Grade') ? 'final_adjusted' : 'fraction' });
                    }
                    const colspan = cell.colSpan || 1, rowspan = cell.rowSpan || 1;
                    for (let r = 0; r < rowspan; r++) {
                        if (!grid[rowIndex + r]) grid[rowIndex + r] = [];
                        for (let c = 0; c < colspan; c++) grid[rowIndex + r][colIndex + c] = true;
                    }
                    colIndex += colspan;
                });
            });
            console.log('[D2L InlineEdit] Mapped Column IDs:', columnIdMap);
        }

        function isEditableCell(cell) {
            const text = cell.innerText.trim();
            if (!text) return false;
            if (/(-|\d+(?:\.\d+)?)\s*\/\s*(-|\d+(?:\.\d+)?)/.test(text)) return true;
            return !/^(A|B|C|D|F|P|NP|E|S|N|M|I|Beginning|Developing|Proficient|Exemplary)$/i.test(text);
        }

        // ── Main ──
        mapColumnIds();
        gridTable.querySelectorAll('tbody tr td.d_gr').forEach(cell => {
            if (columnIdMap.has(cell.cellIndex) && isEditableCell(cell)) editableCells.add(cell);
        });

        console.log(`[D2L InlineEdit] Found ${editableCells.size} editable cells.`);
        if (!editableCells.size) { console.log('[D2L InlineEdit] No editable cells. Aborting.'); return; }

        // Single listener on shadow root — resolve light-DOM td via composedPath()
        shadowRoot.addEventListener('dblclick', e => {
            const cell = e.composedPath().find(el => editableCells.has(el));
            if (!cell) return;
            e.preventDefault(); e.stopPropagation();
            const text = cell.innerText.trim();
            const fracMatch = text.match(/(-|\d+(?:\.\d+)?)\s*\/\s*(-|\d+(?:\.\d+)?)/);
            fracMatch ? handleFractionEdit(cell, text, fracMatch) : handleTextEdit(cell, text);
        }, true);

        createSaveButtons();
        console.log('[D2L InlineEdit] Ready! Double-click a grade to edit.');

    } // end init()

})();
