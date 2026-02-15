// ==UserScript==
// @name         Juliet - Entrata Quick Log
// @namespace    http://tampermonkey.net/
// @version      0.1.1
// @description  Streamline lead activity logging in Entrata CRM
// @author       Samuel Lee
// @match        https://*.entrata.com/*module=applications*
// @match        https://ach.entrata.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // Configuration & State Management
    // ============================================
    
    const STORAGE_KEY = 'juliet_activity_template';
    
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
     * Inject CSS styles for Quick Log buttons
     */
    function injectButtonStyles() {
        if (document.getElementById('juliet-styles')) {
            return; // Styles already injected
        }
        
        const styleTag = document.createElement('style');
        styleTag.id = 'juliet-styles';
        styleTag.textContent = `
            .juliet-quick-log-btn {
                background: linear-gradient(to bottom, #4a90e2 0%, #357abd 100%) !important;
                border: 2px solid #2e6da4 !important;
                border-radius: 4px !important;
                color: white !important;
                padding: 8px 16px !important;
                font-size: 13px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                white-space: nowrap !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
                display: inline-block !important;
                min-width: 90px !important;
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
                white-space: nowrap;
                min-width: 120px !important;
                width: 10% !important;
                background-color: #f5f5f5 !important;
            }
            
            .juliet-quick-log-cell {
                text-align: center;
                vertical-align: middle;
                padding: 8px !important;
                min-width: 120px !important;
                width: 10% !important;
                background-color: #fafafa !important;
            }
        `;
        document.head.appendChild(styleTag);
        console.log('[Juliet] Button styles injected');
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
        button.textContent = 'Quick Log';
        button.setAttribute('data-lead-id', leadId);
        button.setAttribute('data-lead-name', leadName);
        
        button.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent default button action
            e.stopPropagation(); // Prevent event bubbling
            e.stopImmediatePropagation(); // Stop other handlers on same element
            
            const id = this.getAttribute('data-lead-id');
            const name = this.getAttribute('data-lead-name');
            
            console.log('[Juliet] Quick Log clicked for:', { id, name });
            alert(`Quick Log clicked!\n\nLead ID: ${id}\nLead Name: ${name}`);
            
            // FR-2 will replace this with actual API logging
            return false; // Extra safety to prevent any default behavior
        });
        
        return button;
    }
    
    /**
     * Inject Preferences button into the page
     * TODO: Implement actual injection logic
     */
    function injectPreferencesButton() {
        console.log('[Juliet] Preferences button injection - TODO (future feature)');
        // Implementation coming in future version
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
            th.textContent = 'Quick Log';
            th.width = '10%'; // Explicit width to ensure visibility
            th.style.minWidth = '120px'; // Minimum width
            th.style.backgroundColor = '#f5f5f5'; // Visual confirmation
            headerRow.appendChild(th);
            console.log('[Juliet] Header column added with width:', th.width);
        }
        
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
            td.style.minWidth = '120px';
            td.style.width = '10%';
            td.style.backgroundColor = '#fafafa';
            
            const button = createQuickLogButton(leadId, leadName);
            td.appendChild(button);
            
            row.appendChild(td);
            
            // Mark row as injected to prevent duplicates
            row.setAttribute('data-juliet-injected', 'true');
            
            buttonCount++;
            
            // Debug: Log first button injection
            if (buttonCount === 1) {
                console.log('[Juliet] First button cell created:', {
                    tdClass: td.className,
                    tdWidth: td.style.width,
                    buttonText: button.textContent,
                    parentRow: row
                });
            }
        });
        
        console.log(`[Juliet] Successfully injected ${buttonCount} Quick Log buttons`);
        
        // Debug: Count actual buttons in DOM
        const actualButtons = document.querySelectorAll('.juliet-quick-log-btn');
        const actualCells = document.querySelectorAll('.juliet-quick-log-cell');
        console.log('[Juliet] DOM verification:', {
            buttonsInDOM: actualButtons.length,
            cellsInDOM: actualCells.length,
            sampleButton: actualButtons[0],
            sampleCell: actualCells[0]
        });
        
        // Make function available in console for debugging
        window.julietDebug = function() {
            const buttons = document.querySelectorAll('.juliet-quick-log-btn');
            const cells = document.querySelectorAll('.juliet-quick-log-cell');
            const header = document.querySelector('.juliet-quick-log-header');
            console.log('Juliet Debug Info:', {
                buttons: buttons.length,
                cells: cells.length,
                header: header,
                sampleButton: buttons[0],
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
        const existingButtons = table.querySelectorAll('.juliet-quick-log-btn');
        
        // Check if button count matches row count
        if (leadRows.length !== existingButtons.length) {
            console.log(`[Juliet] Button mismatch detected: ${existingButtons.length} buttons for ${leadRows.length} rows. Re-injecting...`);
            injectQuickLogButtons();
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
     * Open preferences modal for template configuration
     * TODO: Implement modal UI and logic
     */
    function openPreferencesModal() {
        console.log('[Juliet] Opening preferences modal - TODO');
        // Implementation coming soon
    }
    
    // ============================================
    // API Communication
    // ============================================
    
    /**
     * Log activity to Entrata API
     * @param {string} leadId - The ID of the lead to log activity for
     * @param {object} template - The activity template to use
     * TODO: Reverse engineer Entrata API endpoints and payload structure
     */
    function logActivity(leadId, template) {
        console.log('[Juliet] Logging activity for lead:', leadId, 'with template:', template);
        // Implementation coming soon
        // Will use GM_xmlhttpRequest to make API call
    }
    
    // ============================================
    // Main Initialization
    // ============================================
    
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
            
            // Inject UI elements
            injectPreferencesButton();
            injectQuickLogButtons();
            
            // Setup observer for dynamic content
            setupMutationObserver();
            
            // Setup event listeners for immediate detection
            setupEventListeners();
            
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
