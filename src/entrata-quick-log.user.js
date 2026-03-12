// ==UserScript==
// @name         Juliet 
// @namespace    http://tampermonkey.net/
// @version      0.3.1
// @description  Streamline lead activity logging in Entrata CRM
// @author       Samuel Lee
// @match        https://*.entrata.com/*module=applications*
// @match        https://ach.entrata.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api-prod-client.heymarket.com
// @connect      app.heymarket.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // Configuration & State Management
    // ============================================
    
    const STORAGE_KEY = 'juliet_activity_template';
    const TEXT_TEMPLATE_STORAGE_KEY = 'juliet_text_template';
    const HEYMARKET_CONFIG_STORAGE_KEY = 'juliet_heymarket_config';
    const HEYMARKET_API_BASE = 'https://api-prod-client.heymarket.com';
    const HEYMARKET_COMPLIANCE_PATH = '/v2/message/compliance';
    const HEYMARKET_SEND_PATH = '/v3/message/send';

    // Tracks whether the Cmd (Meta) key is currently held down
    let cmdHeld = false;

    function toggleCmdVisualState(isHeld) {
        document.querySelectorAll('.juliet-quick-log-btn').forEach(btn => {
            btn.classList.toggle('juliet-quick-log-btn--cmd', isHeld);
        });

        document.querySelectorAll('.juliet-quick-text-btn').forEach(btn => {
            btn.classList.toggle('juliet-quick-text-btn--cmd', isHeld);
        });
    }

    /**
     * Setup Cmd key listeners to toggle quick action mode visual indicator
     */
    function setupCmdKeyListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Meta' && !cmdHeld) {
                cmdHeld = true;
                toggleCmdVisualState(true);
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Meta') {
                cmdHeld = false;
                toggleCmdVisualState(false);
            }
        });

        // Safety: clear cmd state if window loses focus mid-hold
        window.addEventListener('blur', () => {
            cmdHeld = false;
            toggleCmdVisualState(false);
        });

        console.log('[Juliet] Cmd key listeners setup');
    }

    /**
     * Get saved activity template from localStorage
     */
    function getTemplate() {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    }
    
    /**
     * Save activity template to localStorage
     */
    function saveTemplate(template) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(template));
    }

    function getTextTemplate() {
        const stored = localStorage.getItem(TEXT_TEMPLATE_STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    }

    function saveTextTemplate(template) {
        localStorage.setItem(TEXT_TEMPLATE_STORAGE_KEY, JSON.stringify(template));
    }

    function getHeymarketConfig() {
        const emptyConfig = {
            securityToken: '',
            teamId: '',
            inboxId: ''
        };

        const stored = localStorage.getItem(HEYMARKET_CONFIG_STORAGE_KEY);
        if (!stored) {
            return emptyConfig;
        }

        try {
            const parsed = JSON.parse(stored);
            return {
                securityToken: parsed?.securityToken || '',
                teamId: parsed?.teamId || '',
                inboxId: parsed?.inboxId || ''
            };
        } catch (error) {
            console.warn('[Juliet] Invalid Heymarket config in localStorage, resetting to defaults', error);
            return emptyConfig;
        }
    }

    function saveHeymarketConfig(config) {
        const current = getHeymarketConfig();
        const merged = {
            securityToken: config?.securityToken ?? current.securityToken,
            teamId: config?.teamId ?? current.teamId,
            inboxId: config?.inboxId ?? current.inboxId
        };
        localStorage.setItem(HEYMARKET_CONFIG_STORAGE_KEY, JSON.stringify(merged));
    }

    function normalizePhoneNumber(rawPhone) {
        if (!rawPhone) return null;
        const digits = String(rawPhone).replace(/\D/g, '');
        if (digits.length === 11 && digits.startsWith('1')) {
            return `+${digits}`;
        }
        if (digits.length === 10) {
            return `+1${digits}`;
        }
        return digits.length >= 10 ? `+${digits}` : null;
    }

    function getLeadPhoneNumber(leadRow) {
        if (!leadRow) return null;
        const leadCell = leadRow.querySelector('td:nth-child(2)');
        if (!leadCell) return null;
        const text = leadCell.textContent || '';
        const match = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
        return normalizePhoneNumber(match ? match[0] : null);
    }

    function getLeadFirstName(leadName) {
        if (!leadName) return '';
        const cleaned = String(leadName).trim();
        if (!cleaned) return '';

        // Entrata rows often display "Last, First"
        if (cleaned.includes(',')) {
            const parts = cleaned.split(',');
            if (parts[1]) {
                return parts[1].trim().split(/\s+/)[0] || '';
            }
        }

        // Fallback: "First Last"
        return cleaned.split(/\s+/)[0] || '';
    }

    function applyLeadTokens(text, leadName) {
        if (typeof text !== 'string') return text;
        const firstName = getLeadFirstName(leadName);
        return text.split('*LEAD_NAME_FIRST*').join(firstName);
    }
    
    // ============================================
    // Page Detection
    // ============================================
    
    /**
     * Check if current page is the leads/applications page
     * @returns {boolean} True if on leads page
     */
    function isLeadsPage() {
        const url = window.location.href;
        const hasTable = document.querySelector('#tbl_prospects') !== null;
        const hasLeadsModule = url.includes('module=applications') || url.includes('module=applicationsxxx');
        
        console.log('[Juliet] Page Detection:', {
            url: url,
            hasTable: hasTable,
            hasLeadsModule: hasLeadsModule
        });
        
        return hasTable || hasLeadsModule;
    }
    
    /**
     * Wait for the leads table to appear in the DOM
     * @param {number} maxAttempts - Maximum number of attempts
     * @param {number} interval - Milliseconds between attempts
     * @returns {Promise<boolean>} True if table found
     */
    function waitForTable(maxAttempts = 10, interval = 500) {
        return new Promise((resolve) => {
            let attempts = 0;
            
            const checkTable = () => {
                attempts++;
                const table = document.querySelector('#tbl_prospects');
                
                if (table) {
                    console.log(`[Juliet] Table found after ${attempts} attempt(s)`);
                    resolve(true);
                } else if (attempts >= maxAttempts) {
                    console.log(`[Juliet] Table not found after ${maxAttempts} attempts`);
                    resolve(false);
                } else {
                    setTimeout(checkTable, interval);
                }
            };
            
            checkTable();
        });
    }
    
    // ============================================
    // UI Styling
    // ============================================
    
    /**
     * Inject CSS styles for Quick Log buttons and modal
     */
    function injectButtonStyles() {
        if (document.getElementById('juliet-styles')) {
            return; // Styles already injected
        }
        
        const styleTag = document.createElement('style');
        styleTag.id = 'juliet-styles';
        styleTag.textContent = `
            /* Quick Log Button Styles */
            .juliet-quick-log-btn {
                background: linear-gradient(to bottom, #4a90e2 0%, #357abd 100%) !important;
                border: 2px solid #2e6da4 !important;
                border-radius: 4px !important;
                color: white !important;
                padding: 0 !important;
                font-size: 18px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 34px !important;
                height: 34px !important;
                min-width: unset !important;
            }
            
            .juliet-quick-log-btn:hover {
                background: linear-gradient(to bottom, #5aa1f2 0%, #4080cd 100%);
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                transform: translateY(-1px);
            }
            
            .juliet-quick-log-btn:active {
                background: linear-gradient(to bottom, #357abd 0%, #2e6da4 100%);
                box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
                transform: translateY(0);
            }
            
            .juliet-quick-log-header {
                text-align: center;
                font-weight: bold;
                white-space: normal !important;
                min-width: 220px !important;
                width: 220px !important;
                background-color: #f5f5f5 !important;
                padding: 10px !important;
            }
            
            .juliet-quick-log-cell {
                text-align: center;
                vertical-align: middle;
                padding: 8px !important;
                min-width: 220px !important;
                width: 220px !important;
                background-color: #fafafa !important;
            }

            .juliet-row-actions {
                display: inline-flex !important;
                align-items: center !important;
                gap: 8px !important;
            }

            .juliet-top-config-buttons {
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                margin-left: 6px !important;
                flex-wrap: nowrap !important;
                vertical-align: middle !important;
            }

            .juliet-top-config-buttons .juliet-prefs-btn {
                margin: 0 !important;
                padding: 4px 9px !important;
                height: 24px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                line-height: 1 !important;
            }

            .juliet-quick-text-btn {
                background: linear-gradient(to bottom, #f0ad4e 0%, #ec971f 100%) !important;
                border: 2px solid #d58512 !important;
                border-radius: 4px !important;
                color: white !important;
                padding: 0 !important;
                font-size: 18px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 34px !important;
                height: 34px !important;
                min-width: unset !important;
            }

            .juliet-quick-text-btn:hover {
                background: linear-gradient(to bottom, #f4ba64 0%, #f0a232 100%);
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                transform: translateY(-1px);
            }

            .juliet-quick-text-btn:active {
                background: linear-gradient(to bottom, #ec971f 0%, #d58512 100%);
                box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
                transform: translateY(0);
            }
            
            /* Preferences Button Styles */
            .juliet-prefs-btn {
                background: linear-gradient(to bottom, #5cb85c 0%, #449d44 100%) !important;
                border: 2px solid #398439 !important;
                border-radius: 4px !important;
                color: white !important;
                padding: 6px 10px !important;
                font-size: 11px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                white-space: nowrap !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
                display: inline-block !important;
                margin: 6px auto 0 !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: relative !important;
                z-index: 999 !important;
                text-align: center !important;
            }
            
            .juliet-prefs-btn:hover {
                background: linear-gradient(to bottom, #6cc76c 0%, #52ad52 100%);
                transform: translateY(-1px);
            }
            
            .juliet-prefs-btn:active {
                background: linear-gradient(to bottom, #449d44 0%, #398439 100%);
                box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
                transform: translateY(0);
            }

            .juliet-prefs-btn--text {
                background: linear-gradient(to bottom, #f0ad4e 0%, #ec971f 100%) !important;
                border: 2px solid #d58512 !important;
            }

            .juliet-prefs-btn--text:hover {
                background: linear-gradient(to bottom, #f4ba64 0%, #f0a232 100%) !important;
            }
            
            /* Modal Styles */
            .juliet-modal-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.2s ease;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            .juliet-modal {
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                animation: slideIn 0.3s ease;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateY(-50px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            
            .juliet-modal-header {
                padding: 20px 24px;
                border-bottom: 1px solid #e5e5e5;
                background-color: #f9f9f9;
                border-radius: 8px 8px 0 0;
            }
            
            .juliet-modal-title {
                margin: 0;
                font-size: 20px;
                font-weight: 700;
                color: #333;
            }
            
            .juliet-modal-body {
                padding: 24px;
            }
            
            .juliet-form-group {
                margin-bottom: 20px;
            }
            
            .juliet-form-label {
                display: block;
                margin-bottom: 8px;
                font-weight: 600;
                font-size: 14px;
                color: #333;
            }
            
            .juliet-form-select {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 14px;
                background-color: white;
                transition: border-color 0.2s ease;
            }
            
            .juliet-form-select:focus {
                outline: none;
                border-color: #4a90e2;
                box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
            }
            
            .juliet-radio-group {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .juliet-radio-option {
                display: flex;
                align-items: center;
                cursor: pointer;
            }
            
            .juliet-radio-option input[type="radio"] {
                margin-right: 8px;
                cursor: pointer;
            }
            
            .juliet-radio-option label {
                cursor: pointer;
                font-size: 14px;
                color: #555;
            }
            
            .juliet-form-textarea {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 14px;
                font-family: inherit;
                resize: vertical;
                min-height: 80px;
                transition: border-color 0.2s ease;
            }
            
            .juliet-form-textarea:focus {
                outline: none;
                border-color: #4a90e2;
                box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
            }
            
            .juliet-validation-msg {
                color: #d9534f;
                font-size: 12px;
                margin-top: 6px;
                display: none;
            }
            
            .juliet-validation-msg.show {
                display: block;
            }
            
            .juliet-modal-footer {
                padding: 16px 24px;
                border-top: 1px solid #e5e5e5;
                background-color: #f9f9f9;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                border-radius: 0 0 8px 8px;
            }
            
            .juliet-btn {
                padding: 10px 20px;
                border: none;
                border-radius: 4px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            
            .juliet-btn-cancel {
                background-color: #f5f5f5;
                color: #333;
                border: 1px solid #ccc;
            }
            
            .juliet-btn-cancel:hover {
                background-color: #e5e5e5;
            }
            
            .juliet-btn-primary {
                background: linear-gradient(to bottom, #4a90e2 0%, #357abd 100%);
                color: white;
                border: 2px solid #2e6da4;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            
            .juliet-btn-primary:hover:not(:disabled) {
                background: linear-gradient(to bottom, #5aa1f2 0%, #4080cd 100%);
                transform: translateY(-1px);
            }
            
            .juliet-btn-primary:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* Cmd-held quick-log mode indicator */
            .juliet-quick-log-btn--cmd {
                background: linear-gradient(to bottom, #1d3557 0%, #0d2137 100%) !important;
                border-color: #0a1a2e !important;
            }

            .juliet-quick-text-btn--cmd {
                background: linear-gradient(to bottom, #8a5a0a 0%, #6f4709 100%) !important;
                border-color: #5a3906 !important;
            }
        `;
        document.head.appendChild(styleTag);
        console.log('[Juliet] Button and modal styles injected');
    }
    
    // ============================================
    // UI Injection
    // ============================================
    
    /**
     * Create a Quick Log button for a lead row
     * @param {string} leadId - The application/lead ID
     * @param {string} leadName - The lead's name
     * @returns {HTMLButtonElement} The button element
     */
    function createQuickLogButton(leadId, leadName) {
        const button = document.createElement('button');
        button.className = 'juliet-quick-log-btn';
        if (cmdHeld) {
            button.classList.add('juliet-quick-log-btn--cmd');
        }
        button.textContent = '📝';
        button.title = 'Log activity (Cmd+click to quick log)';
        button.setAttribute('data-lead-id', leadId);
        button.setAttribute('data-lead-name', leadName);
        
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const leadId = this.getAttribute('data-lead-id');
            const leadName = this.getAttribute('data-lead-name');

            console.log('[Juliet] Log button clicked for:', { leadId, leadName, quickMode: e.metaKey || cmdHeld });

            const template = getTemplate();

            if (!template) {
                alert('Please configure your activity template first.\n\nClick the Preferences button to set up your template.');
                return false;
            }

            const row = this.closest('tr.load_lead_details');
            const customerId = getCustomerId(row);

            if (!customerId) {
                alert('Error: Could not find customer ID.\n\nPlease report this issue.');
                return false;
            }

            const tokenizedTemplate = {
                ...template,
                notes: applyLeadTokens(template.notes || '', leadName)
            };

            if (e.metaKey || cmdHeld) {
                // Cmd+click: instant log with saved template
                logActivity(leadId, customerId, tokenizedTemplate, this);
            } else {
                // Normal click: open pre-filled log modal
                openLogModal(leadId, customerId, tokenizedTemplate, this, leadName);
            }

            return false;
        });
        
        return button;
    }

    function createQuickTextButton(leadId, leadName) {
        const button = document.createElement('button');
        button.className = 'juliet-quick-text-btn';
        if (cmdHeld) {
            button.classList.add('juliet-quick-text-btn--cmd');
        }
        button.textContent = '💬';
        button.title = 'Text lead (Cmd+click to quick send)';
        button.setAttribute('data-lead-id', leadId);
        button.setAttribute('data-lead-name', leadName);

        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const leadName = this.getAttribute('data-lead-name') || '';
            const row = this.closest('tr.load_lead_details');
            const phone = getLeadPhoneNumber(row);
            if (!phone) {
                showError(this, 'Could not extract lead phone number');
                return false;
            }

            const template = getTextTemplate();
            if (!template || !template.message || template.message.trim().length === 0) {
                alert('Please configure your Heymarket message template first.');
                return false;
            }

            const tokenizedMessage = applyLeadTokens(template.message.trim(), leadName);

            if (e.metaKey || cmdHeld) {
                sendHeymarketText({
                    phone,
                    message: tokenizedMessage,
                    button: this
                });
            } else {
                openTextComposeModal(phone, tokenizedMessage, this, leadName);
            }

            return false;
        });

        return button;
    }
    
    /**
     * Inject configuration buttons inline with the top Email action control.
     * Falls back gracefully if Email control cannot be located.
     */
    function injectPreferencesButton() {
        const emailControl = Array.from(document.querySelectorAll('a, button, span')).find((el) => {
            const label = (el.textContent || '').trim().toLowerCase();
            return label === 'email';
        });

        if (!emailControl) {
            console.warn('[Juliet] Could not find Email control for inline config buttons');
            return;
        }

        const emailContainer = emailControl.closest('td, th, li, div') || emailControl.parentElement;
        if (!emailContainer || !emailContainer.parentElement) {
            console.warn('[Juliet] Could not find Email container parent for inline config buttons');
            return;
        }

        const actionRow = emailContainer.parentElement;
        let configRow = actionRow.querySelector('.juliet-config-buttons');
        if (!configRow) {
            const wrapperTag = emailContainer.tagName && emailContainer.tagName.toLowerCase() === 'li' ? 'li' : 'div';
            configRow = document.createElement(wrapperTag);
            configRow.className = 'juliet-config-buttons juliet-top-config-buttons';

            // Keep Entrata's Email split control together (Email + dropdown toggle).
            const emailDropdownSibling = emailContainer.nextElementSibling;
            const insertionAnchor = emailDropdownSibling || emailContainer;
            if (insertionAnchor.nextElementSibling) {
                actionRow.insertBefore(configRow, insertionAnchor.nextElementSibling);
            } else {
                actionRow.appendChild(configRow);
            }
        }

        if (!configRow.querySelector('.juliet-text-prefs-btn')) {
            const textPrefsBtn = document.createElement('button');
            textPrefsBtn.className = 'juliet-prefs-btn juliet-prefs-btn--text juliet-text-prefs-btn';
            textPrefsBtn.textContent = '💬 Text';
            textPrefsBtn.title = 'Configure Heymarket text settings';
            textPrefsBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                openTextPreferencesModal();
            });
            configRow.appendChild(textPrefsBtn);
        }

        if (!configRow.querySelector('.juliet-log-prefs-btn')) {
            const logPrefsBtn = document.createElement('button');
            logPrefsBtn.className = 'juliet-prefs-btn juliet-log-prefs-btn';
            logPrefsBtn.textContent = '⚙ Log';
            logPrefsBtn.title = 'Configure activity template';
            logPrefsBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                openPreferencesModal();
            });
            configRow.appendChild(logPrefsBtn);
        }
        
        console.log('[Juliet] Inline configuration buttons injected');
    }
    
    /**
     * Inject Quick Log buttons into each lead row
     */
    function injectQuickLogButtons() {
        const table = document.querySelector('#tbl_prospects');
        
        if (!table) {
            console.log('[Juliet] Leads table not found on this page');
            return;
        }
        
        console.log('[Juliet] Leads table found, injecting Quick Log buttons...');
        
        // Inject column header
        const headerRow = table.querySelector('thead tr');
        if (headerRow && !headerRow.querySelector('.juliet-quick-log-header')) {
            const th = document.createElement('th');
            th.className = 'juliet-quick-log-header';
            th.width = '220px'; // Fixed width to fit two action buttons
            th.style.minWidth = '220px'; // Minimum width
            th.style.width = '220px'; // Explicit width
            th.style.backgroundColor = '#f5f5f5'; // Visual confirmation
            th.style.verticalAlign = 'middle'; // Center content
            th.style.padding = '10px'; // Add padding
            
            // Create container div for better layout control
            const container = document.createElement('div');
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            container.style.gap = '8px';
            container.style.visibility = 'visible';
            container.style.opacity = '1';
            container.style.position = 'relative';
            container.style.zIndex = '1';
            
            // Add title
            const title = document.createElement('div');
            title.textContent = 'Quick Actions';
            title.style.fontWeight = 'bold';
            container.appendChild(title);
            th.appendChild(container);
            
            headerRow.appendChild(th);
            console.log('[Juliet] Header column added with width:', th.width);
        }
        injectPreferencesButton();
        
        // Inject buttons into each lead row
        const leadRows = table.querySelectorAll('tr.load_lead_details');
        let buttonCount = 0;
        
        leadRows.forEach(row => {
            // Skip if button already exists (check both cell and tracking attribute)
            if (row.querySelector('.juliet-quick-log-cell') || row.getAttribute('data-juliet-injected') === 'true') {
                return;
            }
            
            const leadId = row.getAttribute('data-appid');
            if (!leadId) {
                console.warn('[Juliet] Row missing data-appid attribute:', row);
                return;
            }
            
            // Extract lead name from the row
            const leadNameElement = row.querySelector('td:nth-child(2) em');
            const leadName = leadNameElement ? leadNameElement.textContent.trim() : 'Unknown';
            
            // Create button cell
            const td = document.createElement('td');
            td.className = 'juliet-quick-log-cell';
            td.style.minWidth = '220px';
            td.style.width = '220px';
            td.style.backgroundColor = '#fafafa';
            
            const actionGroup = document.createElement('div');
            actionGroup.className = 'juliet-row-actions';
            const logButton = createQuickLogButton(leadId, leadName);
            const textButton = createQuickTextButton(leadId, leadName);
            actionGroup.appendChild(textButton);
            actionGroup.appendChild(logButton);
            td.appendChild(actionGroup);
            
            row.appendChild(td);
            
            // Mark row as injected to prevent duplicates
            row.setAttribute('data-juliet-injected', 'true');
            
            buttonCount++;
            
            // Debug: Log first button injection
            if (buttonCount === 1) {
                console.log('[Juliet] First button cell created:', {
                    tdClass: td.className,
                    tdWidth: td.style.width,
                    logButtonText: logButton.textContent,
                    textButtonText: textButton.textContent,
                    parentRow: row
                });
            }
        });
        
        console.log(`[Juliet] Successfully injected ${buttonCount} Quick Log buttons`);
        
        // Debug: Count actual buttons in DOM
        const actualButtons = document.querySelectorAll('.juliet-quick-log-btn');
        const actualTextButtons = document.querySelectorAll('.juliet-quick-text-btn');
        const actualCells = document.querySelectorAll('.juliet-quick-log-cell');
        console.log('[Juliet] DOM verification:', {
            buttonsInDOM: actualButtons.length,
            textButtonsInDOM: actualTextButtons.length,
            cellsInDOM: actualCells.length,
            sampleButton: actualButtons[0],
            sampleTextButton: actualTextButtons[0],
            sampleCell: actualCells[0]
        });
        
        // Make function available in console for debugging
        window.julietDebug = function() {
            const buttons = document.querySelectorAll('.juliet-quick-log-btn');
            const textButtons = document.querySelectorAll('.juliet-quick-text-btn');
            const cells = document.querySelectorAll('.juliet-quick-log-cell');
            const header = document.querySelector('.juliet-quick-log-header');
            console.log('Juliet Debug Info:', {
                buttons: buttons.length,
                textButtons: textButtons.length,
                cells: cells.length,
                header: header,
                sampleButton: buttons[0],
                sampleTextButton: textButtons[0],
                sampleCell: cells[0],
                tableWidth: document.querySelector('#tbl_prospects')?.offsetWidth
            });
            if (buttons[0]) {
                buttons[0].style.border = '5px solid red';
                console.log('First button highlighted in RED');
            }
            if (header) {
                header.style.backgroundColor = 'yellow';
                console.log('Header highlighted in YELLOW');
            }
        };
        console.log('[Juliet] Run window.julietDebug() in console to highlight elements');
    }
    
    /**
     * Check if buttons are still present and re-inject if needed
     * This is called by both the MutationObserver and polling mechanism
     */
    function checkAndReinject() {
        const table = document.querySelector('#tbl_prospects');
        
        if (!table) {
            console.log('[Juliet] Table not found, cannot check buttons');
            return;
        }
        
        const leadRows = table.querySelectorAll('tr.load_lead_details');
        const existingLogButtons = table.querySelectorAll('.juliet-quick-log-btn');
        const existingTextButtons = table.querySelectorAll('.juliet-quick-text-btn');
        
        // Check if button counts match row count
        if (leadRows.length !== existingLogButtons.length || leadRows.length !== existingTextButtons.length) {
            console.log(`[Juliet] Button mismatch detected: ${existingLogButtons.length} log / ${existingTextButtons.length} text buttons for ${leadRows.length} rows. Re-injecting...`);
            injectQuickLogButtons();
            injectPreferencesButton(); // Re-inject preferences button too
        }
        
        // Check if preferences button is missing (might be removed during table refresh)
        const logPrefsBtn = document.querySelector('.juliet-log-prefs-btn');
        const textPrefsBtn = document.querySelector('.juliet-text-prefs-btn');
        if (!logPrefsBtn || !textPrefsBtn) {
            console.log('[Juliet] Inline config buttons missing, re-injecting...');
            injectPreferencesButton();
        }
    }
    
    // Store polling interval ID to prevent duplicates
    let pollingIntervalId = null;
    
    /**
     * Start polling mechanism to detect when buttons disappear
     * Checks every 500ms if buttons need re-injection
     */
    function startPolling() {
        // Clear existing interval if any
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
        }
        
        pollingIntervalId = setInterval(() => {
            if (isLeadsPage()) {
                checkAndReinject();
            }
        }, 500); // Check every 500ms for faster response
        
        console.log('[Juliet] Polling started (checks every 500ms)');
    }
    
    /**
     * Setup event listeners for immediate button checks
     * Triggers on scroll and other user interactions
     */
    function setupEventListeners() {
        // Throttle function to prevent too many calls
        let scrollTimeout;
        const throttledCheck = () => {
            if (scrollTimeout) return;
            scrollTimeout = setTimeout(() => {
                checkAndReinject();
                scrollTimeout = null;
            }, 100);
        };
        
        // Listen for scroll events (catches lazy loading)
        window.addEventListener('scroll', throttledCheck, { passive: true });
        
        // Listen for click events on table controls (pagination, filters, sort)
        document.addEventListener('click', (e) => {
            // Check if click was on table-related controls
            const target = e.target;
            if (target.closest('.pagination') || 
                target.closest('th') || 
                target.closest('.filter') ||
                target.tagName === 'TH') {
                setTimeout(checkAndReinject, 200); // Small delay for AJAX to complete
            }
        }, true);
        
        console.log('[Juliet] Event listeners setup (scroll, click)');
    }
    
    /**
     * Setup MutationObserver to watch for dynamically loaded leads
     * Enhanced to detect table replacements, filtering, sorting, and pagination
     */
    function setupMutationObserver() {
        const table = document.querySelector('#tbl_prospects');
        
        if (!table) {
            console.log('[Juliet] Table not found, skipping MutationObserver setup');
            return;
        }
        
        // Get the parent container of the table for higher-level observation
        const tableParent = table.parentElement || document.body;
        
        const observer = new MutationObserver(mutations => {
            let shouldCheck = false;
            
            mutations.forEach(mutation => {
                // Check for added nodes (new rows, pagination)
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        // Check if it's a lead row or contains lead rows
                        if (node.classList?.contains('load_lead_details') || 
                            node.querySelector?.('.load_lead_details') ||
                            node.id === 'tbl_prospects') {
                            shouldCheck = true;
                        }
                    }
                });
                
                // Check for removed nodes (table replacement, filtering)
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        // If lead rows or the table itself were removed
                        if (node.classList?.contains('load_lead_details') ||
                            node.querySelector?.('.load_lead_details') ||
                            node.id === 'tbl_prospects') {
                            shouldCheck = true;
                        }
                    }
                });
                
                // Check for attribute changes on the table (class changes, etc.)
                if (mutation.type === 'attributes' && mutation.target.id === 'tbl_prospects') {
                    shouldCheck = true;
                }
            });
            
            if (shouldCheck) {
                console.log('[Juliet] Table changes detected by observer, checking buttons...');
                // Use checkAndReinject instead of direct injection
                // Add small delay to ensure DOM is stable
                setTimeout(checkAndReinject, 10);
            }
        });
        
        // Observe at both table and parent level
        observer.observe(tableParent, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });
        
        // Also observe the table itself
        observer.observe(table, {
            childList: true,
            subtree: true,
            attributes: true
        });
        
        console.log('[Juliet] Enhanced MutationObserver setup complete (watching table and parent)');
    }
    
    // ============================================
    // Modal Management
    // ============================================

    /**
     * Open a pre-filled log modal for a specific lead, allowing the user to
     * review and edit fields before submitting.
     * @param {string} leadId
     * @param {string} customerId
     * @param {object} template - Pre-filled from saved template
     * @param {HTMLButtonElement} rowButton - Row button for success/error feedback
     */
    function openLogModal(leadId, customerId, template, rowButton, leadName) {
        console.log('[Juliet] Opening log modal for lead:', leadId);

        const backdrop = document.createElement('div');
        backdrop.className = 'juliet-modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'juliet-modal';

        // Header
        const header = document.createElement('div');
        header.className = 'juliet-modal-header';
        const title = document.createElement('h2');
        title.className = 'juliet-modal-title';
        title.textContent = 'Log Activity';
        header.appendChild(title);

        // Body
        const body = document.createElement('div');
        body.className = 'juliet-modal-body';

        // Event Type dropdown
        const eventTypeGroup = document.createElement('div');
        eventTypeGroup.className = 'juliet-form-group';
        const eventTypeLabel = document.createElement('label');
        eventTypeLabel.className = 'juliet-form-label';
        eventTypeLabel.textContent = 'Event Type';
        const eventTypeSelect = document.createElement('select');
        eventTypeSelect.className = 'juliet-form-select';

        ['Outgoing Call', 'Outgoing Text'].forEach(type => {
            const opt = document.createElement('option');
            opt.value = type;
            opt.textContent = type;
            if (template.eventType === type) opt.selected = true;
            eventTypeSelect.appendChild(opt);
        });

        eventTypeGroup.appendChild(eventTypeLabel);
        eventTypeGroup.appendChild(eventTypeSelect);

        // Call Outcome radio buttons
        const outcomeGroup = document.createElement('div');
        outcomeGroup.className = 'juliet-form-group';
        const outcomeLabel = document.createElement('label');
        outcomeLabel.className = 'juliet-form-label';
        outcomeLabel.textContent = 'Call Outcome';
        outcomeGroup.appendChild(outcomeLabel);

        const radioGroup = document.createElement('div');
        radioGroup.className = 'juliet-radio-group';

        const outcomes = ['Connected', 'Left Voicemail', 'No Answer', 'Wrong Number'];
        outcomes.forEach((outcome, index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'juliet-radio-option';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'juliet-log-outcome';
            radio.value = outcome;
            radio.id = `juliet-log-outcome-${index}`;
            radio.checked = template.outcome === outcome || (!template.outcome && index === 0);

            const label = document.createElement('label');
            label.setAttribute('for', `juliet-log-outcome-${index}`);
            label.textContent = outcome;

            optionDiv.appendChild(radio);
            optionDiv.appendChild(label);
            radioGroup.appendChild(optionDiv);
        });

        outcomeGroup.appendChild(radioGroup);

        // Notes textarea
        const notesGroup = document.createElement('div');
        notesGroup.className = 'juliet-form-group';
        const notesLabel = document.createElement('label');
        notesLabel.className = 'juliet-form-label';
        notesLabel.textContent = 'Notes (Required)';
        const notesTextarea = document.createElement('textarea');
        notesTextarea.className = 'juliet-form-textarea';
        notesTextarea.placeholder = 'Enter activity notes...';
        notesTextarea.value = template.notes || '';

        const validationMsg = document.createElement('div');
        validationMsg.className = 'juliet-validation-msg';
        validationMsg.textContent = 'Notes field is required';

        notesGroup.appendChild(notesLabel);
        notesGroup.appendChild(notesTextarea);
        notesGroup.appendChild(validationMsg);

        body.appendChild(eventTypeGroup);
        body.appendChild(outcomeGroup);
        body.appendChild(notesGroup);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'juliet-modal-footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'juliet-btn juliet-btn-cancel';
        cancelBtn.textContent = 'Cancel';

        const submitBtn = document.createElement('button');
        submitBtn.className = 'juliet-btn juliet-btn-primary';
        submitBtn.textContent = 'Log Activity';

        const updateSubmitBtn = () => {
            submitBtn.disabled = notesTextarea.value.trim().length === 0;
        };
        updateSubmitBtn();
        notesTextarea.addEventListener('input', updateSubmitBtn);

        footer.appendChild(cancelBtn);
        footer.appendChild(submitBtn);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);

        const closeModal = () => {
            backdrop.remove();
            document.removeEventListener('keydown', escapeHandler);
        };

        const escapeHandler = (e) => {
            if (e.key === 'Escape') closeModal();
        };

        cancelBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
        });
        document.addEventListener('keydown', escapeHandler);

        submitBtn.addEventListener('click', () => {
            const notes = notesTextarea.value.trim();

            if (notes.length === 0) {
                validationMsg.classList.add('show');
                notesTextarea.focus();
                return;
            }

            const selectedOutcome = modal.querySelector('input[name="juliet-log-outcome"]:checked');
            if (!selectedOutcome) {
                alert('Please select a call outcome');
                return;
            }

            const editedTemplate = {
                eventType: eventTypeSelect.value,
                outcome: selectedOutcome.value,
                notes: applyLeadTokens(notes, leadName)
            };

            submitBtn.disabled = true;
            submitBtn.textContent = 'Logging...';

            logActivity(leadId, customerId, editedTemplate, rowButton, () => {
                closeModal();
            });
        });

        document.body.appendChild(backdrop);
        notesTextarea.focus();
        notesTextarea.select();
    }

    function openTextComposeModal(phone, initialMessage, rowButton, leadName) {
        const backdrop = document.createElement('div');
        backdrop.className = 'juliet-modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'juliet-modal';

        const header = document.createElement('div');
        header.className = 'juliet-modal-header';
        const title = document.createElement('h2');
        title.className = 'juliet-modal-title';
        title.textContent = `Compose Text (${phone})`;
        header.appendChild(title);

        const body = document.createElement('div');
        body.className = 'juliet-modal-body';

        const messageGroup = document.createElement('div');
        messageGroup.className = 'juliet-form-group';
        const messageLabel = document.createElement('label');
        messageLabel.className = 'juliet-form-label';
        messageLabel.textContent = 'Message (Required)';
        const messageTextarea = document.createElement('textarea');
        messageTextarea.className = 'juliet-form-textarea';
        messageTextarea.placeholder = 'Type your message...';
        messageTextarea.value = initialMessage || '';
        const validationMsg = document.createElement('div');
        validationMsg.className = 'juliet-validation-msg';
        validationMsg.textContent = 'Message is required';

        messageGroup.appendChild(messageLabel);
        messageGroup.appendChild(messageTextarea);
        messageGroup.appendChild(validationMsg);
        body.appendChild(messageGroup);

        const footer = document.createElement('div');
        footer.className = 'juliet-modal-footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'juliet-btn juliet-btn-cancel';
        cancelBtn.textContent = 'Cancel';

        const sendBtn = document.createElement('button');
        sendBtn.className = 'juliet-btn juliet-btn-primary';
        sendBtn.textContent = 'Send Text';

        const updateSendBtn = () => {
            sendBtn.disabled = messageTextarea.value.trim().length === 0;
        };
        updateSendBtn();
        messageTextarea.addEventListener('input', updateSendBtn);

        footer.appendChild(cancelBtn);
        footer.appendChild(sendBtn);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);

        const closeModal = () => {
            backdrop.remove();
            document.removeEventListener('keydown', escapeHandler);
        };

        const escapeHandler = (e) => {
            if (e.key === 'Escape') closeModal();
        };

        cancelBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
        });
        document.addEventListener('keydown', escapeHandler);

        sendBtn.addEventListener('click', () => {
            const message = messageTextarea.value.trim();
            if (message.length === 0) {
                validationMsg.classList.add('show');
                messageTextarea.focus();
                return;
            }

            sendBtn.disabled = true;
            sendBtn.textContent = 'Sending...';

            sendHeymarketText({
                phone,
                message: applyLeadTokens(message, leadName),
                button: rowButton,
                onComplete: closeModal
            });
        });

        document.body.appendChild(backdrop);
        messageTextarea.focus();
        messageTextarea.select();
    }

    /**
     * Open preferences modal for template configuration
     */
    function openPreferencesModal() {
        console.log('[Juliet] Opening preferences modal');
        
        // Load existing template if available
        const existingTemplate = getTemplate();
        
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'juliet-modal-backdrop';
        
        // Create modal container
        const modal = document.createElement('div');
        modal.className = 'juliet-modal';
        
        // Modal header
        const header = document.createElement('div');
        header.className = 'juliet-modal-header';
        const title = document.createElement('h2');
        title.className = 'juliet-modal-title';
        title.textContent = 'Activity Template Configuration';
        header.appendChild(title);
        
        // Modal body with form
        const body = document.createElement('div');
        body.className = 'juliet-modal-body';
        
        // Event Type dropdown
        const eventTypeGroup = document.createElement('div');
        eventTypeGroup.className = 'juliet-form-group';
        const eventTypeLabel = document.createElement('label');
        eventTypeLabel.className = 'juliet-form-label';
        eventTypeLabel.textContent = 'Event Type';
        const eventTypeSelect = document.createElement('select');
        eventTypeSelect.className = 'juliet-form-select';
        eventTypeSelect.id = 'juliet-event-type';
        
        const outgoingCallOption = document.createElement('option');
        outgoingCallOption.value = 'Outgoing Call';
        outgoingCallOption.textContent = 'Outgoing Call';
        
        const outgoingTextOption = document.createElement('option');
        outgoingTextOption.value = 'Outgoing Text';
        outgoingTextOption.textContent = 'Outgoing Text';
        
        eventTypeSelect.appendChild(outgoingCallOption);
        eventTypeSelect.appendChild(outgoingTextOption);
        
        // Set saved value if exists
        if (existingTemplate && existingTemplate.eventType) {
            eventTypeSelect.value = existingTemplate.eventType;
        }
        
        eventTypeGroup.appendChild(eventTypeLabel);
        eventTypeGroup.appendChild(eventTypeSelect);
        
        // Call Outcome radio buttons
        const outcomeGroup = document.createElement('div');
        outcomeGroup.className = 'juliet-form-group';
        const outcomeLabel = document.createElement('label');
        outcomeLabel.className = 'juliet-form-label';
        outcomeLabel.textContent = 'Call Outcome';
        outcomeGroup.appendChild(outcomeLabel);
        
        const radioGroup = document.createElement('div');
        radioGroup.className = 'juliet-radio-group';
        
        const outcomes = ['Connected', 'Left Voicemail', 'No Answer', 'Wrong Number'];
        outcomes.forEach((outcome, index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'juliet-radio-option';
            
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'juliet-outcome';
            radio.value = outcome;
            radio.id = `juliet-outcome-${index}`;
            
            // Set saved value if exists
            if (existingTemplate && existingTemplate.outcome === outcome) {
                radio.checked = true;
            } else if (!existingTemplate && index === 0) {
                // Default to first option if no saved template
                radio.checked = true;
            }
            
            const label = document.createElement('label');
            label.setAttribute('for', `juliet-outcome-${index}`);
            label.textContent = outcome;
            
            optionDiv.appendChild(radio);
            optionDiv.appendChild(label);
            radioGroup.appendChild(optionDiv);
        });
        
        outcomeGroup.appendChild(radioGroup);
        
        // Notes textarea
        const notesGroup = document.createElement('div');
        notesGroup.className = 'juliet-form-group';
        const notesLabel = document.createElement('label');
        notesLabel.className = 'juliet-form-label';
        notesLabel.textContent = 'Notes (Required, supports *LEAD_NAME_FIRST*)';
        const notesTextarea = document.createElement('textarea');
        notesTextarea.className = 'juliet-form-textarea';
        notesTextarea.id = 'juliet-notes';
        notesTextarea.placeholder = 'Enter activity notes...';
        
        // Set saved value if exists
        if (existingTemplate && existingTemplate.notes) {
            notesTextarea.value = existingTemplate.notes;
        }
        
        const validationMsg = document.createElement('div');
        validationMsg.className = 'juliet-validation-msg';
        validationMsg.textContent = 'Notes field is required';
        
        notesGroup.appendChild(notesLabel);
        notesGroup.appendChild(notesTextarea);
        notesGroup.appendChild(validationMsg);
        
        // Assemble body
        body.appendChild(eventTypeGroup);
        body.appendChild(outcomeGroup);
        body.appendChild(notesGroup);
        
        // Modal footer
        const footer = document.createElement('div');
        footer.className = 'juliet-modal-footer';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'juliet-btn juliet-btn-cancel';
        cancelBtn.textContent = 'Cancel';
        
        const saveBtn = document.createElement('button');
        saveBtn.className = 'juliet-btn juliet-btn-primary';
        saveBtn.textContent = 'Save Template';
        saveBtn.id = 'juliet-save-btn';
        
        // Disable save button if notes is empty
        const updateSaveButton = () => {
            const notesValue = notesTextarea.value.trim();
            saveBtn.disabled = notesValue.length === 0;
        };
        
        // Initial state
        updateSaveButton();
        
        // Listen for input changes
        notesTextarea.addEventListener('input', updateSaveButton);
        
        footer.appendChild(cancelBtn);
        footer.appendChild(saveBtn);
        
        // Assemble modal
        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);
        
        // Close modal function
        const closeModal = () => {
            backdrop.remove();
            document.removeEventListener('keydown', escapeHandler);
        };
        
        // ESC key handler
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        
        // Event listeners
        cancelBtn.addEventListener('click', closeModal);
        
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                closeModal();
            }
        });
        
        saveBtn.addEventListener('click', () => {
            const notesValue = notesTextarea.value.trim();
            
            if (notesValue.length === 0) {
                validationMsg.classList.add('show');
                notesTextarea.focus();
                return;
            }
            
            // Get selected outcome
            const selectedOutcome = document.querySelector('input[name="juliet-outcome"]:checked');
            
            if (!selectedOutcome) {
                alert('Please select a call outcome');
                return;
            }
            
            // Build template object
            const template = {
                eventType: eventTypeSelect.value,
                outcome: selectedOutcome.value,
                notes: notesValue
            };
            
            // Save to localStorage
            saveTemplate(template);
            
            console.log('[Juliet] Template saved:', template);
            
            // Show success feedback
            saveBtn.textContent = '✓ Saved!';
            saveBtn.style.background = 'linear-gradient(to bottom, #5cb85c 0%, #449d44 100%)';
            
            // Close modal after short delay
            setTimeout(() => {
                closeModal();
            }, 800);
        });
        
        // Add ESC key listener
        document.addEventListener('keydown', escapeHandler);
        
        // Add modal to page
        document.body.appendChild(backdrop);
        
        // Focus on first input
        eventTypeSelect.focus();
    }

    function openTextPreferencesModal() {
        console.log('[Juliet] Opening text preferences modal');

        const existingTemplate = getTextTemplate() || { message: '' };
        const existingConfig = getHeymarketConfig() || {};

        const backdrop = document.createElement('div');
        backdrop.className = 'juliet-modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'juliet-modal';

        const header = document.createElement('div');
        header.className = 'juliet-modal-header';
        const title = document.createElement('h2');
        title.className = 'juliet-modal-title';
        title.textContent = 'Heymarket Text Configuration';
        header.appendChild(title);

        const body = document.createElement('div');
        body.className = 'juliet-modal-body';

        const messageGroup = document.createElement('div');
        messageGroup.className = 'juliet-form-group';
        const messageLabel = document.createElement('label');
        messageLabel.className = 'juliet-form-label';
        messageLabel.textContent = 'Default Message Template (Required, supports *LEAD_NAME_FIRST*)';
        const messageTextarea = document.createElement('textarea');
        messageTextarea.className = 'juliet-form-textarea';
        messageTextarea.placeholder = 'Hi! Just following up on your inquiry...';
        messageTextarea.value = existingTemplate.message || '';
        const validationMsg = document.createElement('div');
        validationMsg.className = 'juliet-validation-msg';
        validationMsg.textContent = 'Default message is required';

        messageGroup.appendChild(messageLabel);
        messageGroup.appendChild(messageTextarea);
        messageGroup.appendChild(validationMsg);

        const tokenGroup = document.createElement('div');
        tokenGroup.className = 'juliet-form-group';
        const tokenLabel = document.createElement('label');
        tokenLabel.className = 'juliet-form-label';
        tokenLabel.textContent = 'X-Emb-Security-Token';
        const tokenInput = document.createElement('textarea');
        tokenInput.className = 'juliet-form-textarea';
        tokenInput.placeholder = 'Paste X-Emb-Security-Token from Heymarket request headers...';
        tokenInput.value = existingConfig.securityToken || '';
        tokenGroup.appendChild(tokenLabel);
        tokenGroup.appendChild(tokenInput);

        const teamGroup = document.createElement('div');
        teamGroup.className = 'juliet-form-group';
        const teamLabel = document.createElement('label');
        teamLabel.className = 'juliet-form-label';
        teamLabel.textContent = 'Team ID';
        const teamInput = document.createElement('input');
        teamInput.className = 'juliet-form-select';
        teamInput.type = 'text';
        teamInput.placeholder = 'Example: 68917';
        teamInput.value = existingConfig.teamId || '';
        teamGroup.appendChild(teamLabel);
        teamGroup.appendChild(teamInput);

        const inboxGroup = document.createElement('div');
        inboxGroup.className = 'juliet-form-group';
        const inboxLabel = document.createElement('label');
        inboxLabel.className = 'juliet-form-label';
        inboxLabel.textContent = 'Inbox ID';
        const inboxInput = document.createElement('input');
        inboxInput.className = 'juliet-form-select';
        inboxInput.type = 'text';
        inboxInput.placeholder = 'Example: 86613';
        inboxInput.value = existingConfig.inboxId || '';
        inboxGroup.appendChild(inboxLabel);
        inboxGroup.appendChild(inboxInput);

        const sessionNotice = document.createElement('div');
        sessionNotice.style.fontSize = '12px';
        sessionNotice.style.color = '#666';
        sessionNotice.style.marginTop = '-6px';
        sessionNotice.textContent = 'Saved across sessions: token/team/inbox persist in localStorage on this browser profile.';

        body.appendChild(messageGroup);
        body.appendChild(tokenGroup);
        body.appendChild(teamGroup);
        body.appendChild(inboxGroup);
        body.appendChild(sessionNotice);

        const footer = document.createElement('div');
        footer.className = 'juliet-modal-footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'juliet-btn juliet-btn-cancel';
        cancelBtn.textContent = 'Cancel';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'juliet-btn juliet-btn-primary';
        saveBtn.textContent = 'Save Text Settings';

        const updateSaveBtn = () => {
            saveBtn.disabled = messageTextarea.value.trim().length === 0;
        };
        updateSaveBtn();
        messageTextarea.addEventListener('input', updateSaveBtn);

        footer.appendChild(cancelBtn);
        footer.appendChild(saveBtn);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);

        const closeModal = () => {
            backdrop.remove();
            document.removeEventListener('keydown', escapeHandler);
        };

        const escapeHandler = (e) => {
            if (e.key === 'Escape') closeModal();
        };

        cancelBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
        });

        saveBtn.addEventListener('click', () => {
            const message = messageTextarea.value.trim();
            const securityToken = tokenInput.value.trim();
            const teamId = teamInput.value.trim();
            const inboxId = inboxInput.value.trim();
            if (message.length === 0) {
                validationMsg.classList.add('show');
                messageTextarea.focus();
                return;
            }

            if ((teamId && !/^\d+$/.test(teamId)) || (inboxId && !/^\d+$/.test(inboxId))) {
                alert('Team ID and Inbox ID must be numeric.');
                return;
            }

            saveTextTemplate({ message });
            saveHeymarketConfig({
                securityToken,
                teamId,
                inboxId
            });

            saveBtn.textContent = '✓ Saved!';
            saveBtn.style.background = 'linear-gradient(to bottom, #5cb85c 0%, #449d44 100%)';
            setTimeout(closeModal, 800);
        });

        document.addEventListener('keydown', escapeHandler);
        document.body.appendChild(backdrop);
        messageTextarea.focus();
    }
    
    // ============================================
    // API Communication
    // ============================================
    
    /**
     * Map outcome names to Entrata event_result_id values
     */
    function getOutcomeId(outcomeName) {
        const outcomeMap = {
            'Connected': 1505,
            'Left Voicemail': 1085,
            'No Answer': 1083,
            'Wrong Number': 1513
        };
        return outcomeMap[outcomeName] || null;
    }
    
    /**
     * Get customer ID - for now, use application ID as customer ID
     * Customer ID is not available in table, only on detail page
     * If API rejects this, we'll implement background fetch as fallback
     */
    function getCustomerId(leadRow) {
        // Try using application ID as customer ID (they may be the same)
        const appId = leadRow.getAttribute('data-appid');
        
        if (!appId) {
            console.warn('[Juliet] Could not find application ID in row');
            return null;
        }
        
        console.log('[Juliet] Using application ID as customer ID:', appId);
        return appId;
    }
    
    /**
     * Log activity to Entrata API
     * @param {string} leadId - The ID of the lead to log activity for
     * @param {string} customerId - The customer ID (using application ID for now)
     * @param {object} template - The activity template to use
     * @param {HTMLButtonElement} button - The row button element for visual feedback
     * @param {Function} [onSuccess] - Optional callback invoked after success state is shown
     */
    function logActivity(leadId, customerId, template, button, onSuccess) {
        console.log('[Juliet] Logging activity for lead:', leadId, 'customer:', customerId);
        
        // Validate required data
        if (!leadId) {
            showError(button, 'Missing lead ID');
            return;
        }
        
        if (!customerId) {
            showError(button, 'Missing customer ID');
            return;
        }
        
        // Show loading state
        button.disabled = true;
        button.textContent = '⏳';
        button.style.background = 'linear-gradient(to bottom, #f0ad4e 0%, #ec971f 100%)';
        
        // Get outcome ID
        const outcomeId = getOutcomeId(template.outcome);
        if (!outcomeId) {
            showError(button, `Invalid outcome: ${template.outcome}`);
            return;
        }
        
        // Build current date/time in Entrata's format
        const now = new Date();
        const dateFormatted = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}/${now.getFullYear()}`;
        const dateISO = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
        let hours = now.getHours();
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12 || 12;
        const timeFormatted = `${hours.toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}${ampm}`;
        
        // Event type ID (4 = Outgoing Call)
        const eventTypeId = 4;
        
        // Build URL with query parameters
        const baseUrl = 'https://ach.entrata.com/';
        const params = new URLSearchParams({
            'module': 'application_historyxxx',
            'action': 'insert_or_update_application_history',
            'application[id]': leadId,
            'customer[id]': customerId,
            'event[event_type_id]': eventTypeId,
            'event[id]': '',
            'calendar_event[id]': '',
            'calendar_event[event_id]': '',
            'application[property_id]': '',
            'is_from_add_activity_log': '1'
        });
        
        // Build form data (note: duplicated event[start_date] is intentional - Entrata expects both formats)
        const formData = new URLSearchParams();
        formData.append('event[notes]', template.notes);
        formData.append('event[start_date]', dateFormatted);
        formData.append('event[start_date]', dateISO);
        formData.append('event[start_time]', timeFormatted);
        formData.append('event[event_result_id]', outcomeId);
        formData.append('is_event_result_required', '1');
        
        const fullUrl = `${baseUrl}?${params.toString()}`;
        
        console.log('[Juliet] API Request:', {
            url: fullUrl,
            formData: formData.toString(),
            template: template
        });
        
        // Make API request using Tampermonkey's GM_xmlhttpRequest
        GM_xmlhttpRequest({
            method: 'POST',
            url: fullUrl,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            },
            data: formData.toString(),
            onload: function(response) {
                console.log('[Juliet] API Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    responsePreview: response.responseText.substring(0, 200)
                });
                
                if (response.status >= 200 && response.status < 300) {
                    showSuccess(button);
                    if (onSuccess) onSuccess();
                } else {
                    showError(button, `Error ${response.status}`);
                }
            },
            onerror: function(error) {
                console.error('[Juliet] API Network Error:', error);
                showError(button, 'Network error');
            }
        });
    }

    function sendHeymarketText({ phone, message, button, onComplete }) {
        if (!button) return;

        button.disabled = true;
        button.textContent = '⏳';
        button.style.background = 'linear-gradient(to bottom, #f0ad4e 0%, #ec971f 100%)';

        const config = getHeymarketConfig() || {};
        const hasSessionConfig = Boolean(config.securityToken && config.teamId && config.inboxId);

        if (!hasSessionConfig) {
            showError(button, 'Missing Heymarket session config. Open Text settings and add X-Emb-Security-Token, Team ID, and Inbox ID.');
            if (onComplete) onComplete();
            return;
        }

        const recipient = normalizeHeymarketRecipient(phone);
        if (!recipient) {
            showError(button, `Invalid recipient phone: ${phone}`);
            if (onComplete) onComplete();
            return;
        }

        runHeymarketCompliance(message, config)
            .then(() => sendHeymarketMessage(recipient, message, config))
            .then((response) => {
                if (response.status >= 200 && response.status < 300) {
                    showSuccess(button);
                } else {
                    showError(button, `Heymarket send failed (${response.status})`);
                }
            })
            .catch((error) => {
                const errorMsg = error && error.message ? error.message : 'Unknown Heymarket error';
                showError(button, errorMsg);
            })
            .finally(() => {
                if (onComplete) onComplete();
            });
    }

    function normalizeHeymarketRecipient(phone) {
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        if (digits.length === 10) return `1${digits}`;
        if (digits.length === 11 && digits.startsWith('1')) return digits;
        return digits.length > 0 ? digits : null;
    }

    function gmRequestJSON({ method, url, payload, securityToken }) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                anonymous: false,
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json;charset=UTF-8',
                    'X-Emb-Security-Token': securityToken,
                    'Origin': 'https://app.heymarket.com',
                    'Referer': 'https://app.heymarket.com/chats/'
                },
                data: JSON.stringify(payload),
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response);
                        return;
                    }
                    reject(new Error(`HTTP ${response.status}`));
                },
                onerror: (error) => {
                    reject(new Error(error?.error || 'Network error'));
                }
            });
        });
    }

    function runHeymarketCompliance(message, config) {
        return gmRequestJSON({
            method: 'POST',
            url: `${HEYMARKET_API_BASE}${HEYMARKET_COMPLIANCE_PATH}`,
            securityToken: config.securityToken,
            payload: {
                q: message,
                team_id: Number(config.teamId)
            }
        });
    }

    function sendHeymarketMessage(recipient, message, config) {
        const localId = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : `juliet-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

        return gmRequestJSON({
            method: 'POST',
            url: `${HEYMARKET_API_BASE}${HEYMARKET_SEND_PATH}`,
            securityToken: config.securityToken,
            payload: {
                to: recipient,
                text: message,
                local_id: localId,
                conv_title: recipient,
                inbox: Number(config.inboxId)
            }
        });
    }
    
    /**
     * Show success state on button
     * Button stays in success state permanently for visual tracking
     */
    function showSuccess(button) {
        button.textContent = '✅';
        button.style.background = 'linear-gradient(to bottom, #5cb85c 0%, #449d44 100%)';
        button.style.borderColor = '#398439';
        button.disabled = true;
    }
    
    /**
     * Show error state on button
     */
    function showError(button, errorInfo) {
        button.textContent = '❌';
        button.style.background = 'linear-gradient(to bottom, #d9534f 0%, #c9302c 100%)';
        button.style.borderColor = '#ac2925';
        
        console.error('[Juliet] Activity logging failed:', errorInfo);
        
        // Reset after 3 seconds
        setTimeout(() => {
            if (button.classList.contains('juliet-quick-text-btn')) {
                button.textContent = '💬';
                button.style.background = 'linear-gradient(to bottom, #f0ad4e 0%, #ec971f 100%)';
                button.style.borderColor = '#d58512';
            } else {
                button.textContent = '📝';
                button.style.background = 'linear-gradient(to bottom, #4a90e2 0%, #357abd 100%)';
                button.style.borderColor = '#2e6da4';
            }
            button.disabled = false;
        }, 3000);
    }
    
    // ============================================
    // Main Initialization
    // ============================================
    
    /**
     * Create a floating preferences button (backup/fallback)
     * This ensures users can access preferences even if table header button is hidden
     */
    function createFloatingPreferencesButton() {
        // Check if floating button already exists
        if (document.getElementById('juliet-floating-prefs-log')) {
            return;
        }
        
        const buildFloatingBtn = ({ id, text, title, right, bg, border, onClick }) => {
            const btn = document.createElement('button');
            btn.id = id;
            btn.textContent = text;
            btn.title = title;
            btn.style.cssText = `
            position: fixed !important;
            bottom: 30px !important;
            right: ${right}px !important;
            z-index: 99999 !important;
            background: ${bg} !important;
            border: 2px solid ${border} !important;
            border-radius: 6px !important;
            color: white !important;
            padding: 0 !important;
            font-size: 20px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
            width: 44px !important;
            height: 44px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            visibility: visible !important;
            opacity: 1 !important;
        `;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            });
            btn.addEventListener('mouseenter', function() {
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 6px 16px rgba(0,0,0,0.5)';
            });
            btn.addEventListener('mouseleave', function() {
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
            });
            return btn;
        };

        const logFloatingBtn = buildFloatingBtn({
            id: 'juliet-floating-prefs-log',
            text: '⚙️',
            title: 'Configure Quick Log template',
            right: 82,
            bg: 'linear-gradient(to bottom, #5cb85c 0%, #449d44 100%)',
            border: '#398439',
            onClick: () => {
                console.log('[Juliet] Floating log preferences clicked');
                openPreferencesModal();
            }
        });

        const textFloatingBtn = buildFloatingBtn({
            id: 'juliet-floating-prefs-text',
            text: '💬',
            title: 'Configure Heymarket text settings',
            right: 30,
            bg: 'linear-gradient(to bottom, #f0ad4e 0%, #ec971f 100%)',
            border: '#d58512',
            onClick: () => {
                console.log('[Juliet] Floating text preferences clicked');
                openTextPreferencesModal();
            }
        });

        document.body.appendChild(logFloatingBtn);
        document.body.appendChild(textFloatingBtn);
        console.log('[Juliet] Floating Preferences buttons created');
    }

    function removeFloatingPreferencesButtons() {
        ['juliet-floating-prefs', 'juliet-floating-prefs-log', 'juliet-floating-prefs-text'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.remove();
            }
        });
    }
    
    /**
     * Initialize Juliet when page loads
     */
    async function init() {
        console.log('[Juliet] Initializing...');
        
        // Check if we're on the leads page
        if (!isLeadsPage()) {
            console.log('[Juliet] Not on leads page, skipping initialization');
            return;
        }
        
        console.log('[Juliet] Leads page detected!');
        
        // Wait for the table to load (Entrata loads content dynamically)
        const tableFound = await waitForTable();
        
        if (!tableFound) {
            console.warn('[Juliet] Table not found after waiting. Script may not work on this page.');
            return;
        }
        
        try {
            // Inject button styles
            injectButtonStyles();
            
            // Inject UI elements (Quick Log buttons must come first to create the header column)
            injectQuickLogButtons();
            injectPreferencesButton();
            
            // Keep only inline top config controls; remove any legacy floating controls
            removeFloatingPreferencesButtons();
            
            // Setup observer for dynamic content
            setupMutationObserver();
            
            // Setup event listeners for immediate detection
            setupEventListeners();

            // Setup Cmd key listeners for quick-log mode
            setupCmdKeyListeners();
            
            // Start polling mechanism as backup
            startPolling();
            
            console.log('[Juliet] ✓ Initialized successfully');
        } catch (error) {
            console.error('[Juliet] ✗ Initialization failed:', error);
        }
    }
    
    // Wait for page to be fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();
