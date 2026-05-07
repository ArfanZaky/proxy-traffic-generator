// Connect to Socket.IO with reconnection settings
const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 120000
});

// DOM Elements
const targetUrlInput = document.getElementById('targetUrl');
const urlCountBadge = document.getElementById('urlCountBadge');
const verifyUrlInput = document.getElementById('verifyUrl');
const countryWhitelistInput = document.getElementById('countryWhitelist');
const discordWebhookInput = document.getElementById('discordWebhook');
const totalAccessInput = document.getElementById('totalAccess');
const concurrencyInput = document.getElementById('concurrency');
const headlessModeToggle = document.getElementById('headlessMode');
const modeLabel = document.getElementById('modeLabel');
const delayMinInput = document.getElementById('delayMin');
const delayMaxInput = document.getElementById('delayMax');
const loopModeToggle = document.getElementById('loopMode');
const loopCountInput = document.getElementById('loopCount');
const loopInfiniteToggle = document.getElementById('loopInfinite');
const loopHint = document.getElementById('loopHint');
const autoScrollToggle = document.getElementById('autoScroll');
const customProxiesTextarea = document.getElementById('customProxies');
const customProxyCount = document.getElementById('customProxyCount');
const proxyAutoContent = document.getElementById('proxyAutoContent');
const proxyCustomContent = document.getElementById('proxyCustomContent');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const logContainer = document.getElementById('logContainer');
const resultsBody = document.getElementById('resultsBody');
const resultCount = document.getElementById('resultCount');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const progressLabel = document.getElementById('progressLabel');

// Stats elements
const statTotal = document.getElementById('statTotal');
const statSuccess = document.getElementById('statSuccess');
const statFailed = document.getElementById('statFailed');
const statProxies = document.getElementById('statProxies');
const statSpeed = document.getElementById('statSpeed');
const statRate = document.getElementById('statRate');
const copySuccessBtn = document.getElementById('copySuccessBtn');
const detailSuccessBtn = document.getElementById('detailSuccessBtn');
const detailModal = document.getElementById('detailModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const detailTableBody = document.getElementById('detailTableBody');
const modalProxyCount = document.getElementById('modalProxyCount');

// State
let isRunning = false;
let totalRequests = 0;
let successCount = 0;
let failCount = 0;
let startTime = null;
let resultRows = 0;
let proxySource = 'auto'; // 'auto' or 'custom'
const successfulProxies = new Set();
const successfulProxyDetails = []; // Array of {proxy, country, ms}
let allProxiesList = []; // Full list of all proxies from server
let detailSortColumn = 'ms';
let detailSortDirection = 'asc';

// Parse URLs from textarea (one per line)
function parseUrls(text) {
    return text.split('\n')
        .map(u => u.trim())
        .filter(u => u && (u.startsWith('http://') || u.startsWith('https://')));
}

// Update URL count badge
function updateUrlCount() {
    const urls = parseUrls(targetUrlInput.value);
    const count = urls.length;
    urlCountBadge.textContent = count === 1 ? '1 URL' : `${count} URLs`;
    urlCountBadge.style.background = count > 1 ? '#00e676' : 'var(--accent-primary)';
}
targetUrlInput.addEventListener('input', updateUrlCount);
updateUrlCount();

// Proxy source switching
function switchProxySource(source) {
    proxySource = source;
    document.querySelectorAll('.proxy-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.source === source);
    });
    proxyAutoContent.style.display = source === 'auto' ? 'block' : 'none';
    proxyCustomContent.style.display = source === 'custom' ? 'block' : 'none';
}
window.switchProxySource = switchProxySource;

// Custom proxy count updater
if (customProxiesTextarea) {
    customProxiesTextarea.addEventListener('input', () => {
        const lines = customProxiesTextarea.value.split('\n').filter(l => {
            const trimmed = l.trim();
            if (!trimmed) return false;
            // Match: http://user:pass@ip:port or user:pass@ip:port or ip:port
            const urlFormat = /^(?:https?:\/\/)?(?:[^:@]+:[^@]+@)?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/;
            return urlFormat.test(trimmed);
        });
        customProxyCount.textContent = `${lines.length} valid proxies entered`;
    });
}

// Toggle headless mode label
headlessModeToggle.addEventListener('change', () => {
    if (headlessModeToggle.checked) {
        modeLabel.textContent = 'Headless (Hidden)';
    } else {
        modeLabel.textContent = 'Visible Browser';
    }
});

// Toggle loop mode
loopModeToggle.addEventListener('change', () => {
    loopCountInput.disabled = !loopModeToggle.checked;
    loopInfiniteToggle.disabled = !loopModeToggle.checked;
    if (loopModeToggle.checked) {
        loopCountInput.value = 3;
    } else {
        loopInfiniteToggle.checked = false;
        loopCountInput.style.opacity = '';
        loopHint.textContent = 'times';
    }
});

// Toggle infinite loop
loopInfiniteToggle.addEventListener('change', () => {
    if (loopInfiniteToggle.checked) {
        loopCountInput.style.opacity = '0.3';
        loopCountInput.disabled = true;
        loopHint.textContent = '∞ unlimited';
        loopHint.style.color = '#f39c12';
    } else {
        loopCountInput.style.opacity = '';
        loopCountInput.disabled = false;
        loopHint.textContent = 'times';
        loopHint.style.color = '';
    }
});

// Preset configurations
function applyPreset(preset) {
    switch (preset) {
        case 'light':
            totalAccessInput.value = 10;
            concurrencyInput.value = 3;
            delayMinInput.value = 1000;
            delayMaxInput.value = 3000;
            loopModeToggle.checked = false;
            loopCountInput.disabled = true;
            loopCountInput.value = 1;
            loopInfiniteToggle.checked = false;
            loopInfiniteToggle.disabled = true;
            loopCountInput.style.opacity = '';
            loopHint.textContent = 'times';
            loopHint.style.color = '';
            break;
        case 'medium':
            totalAccessInput.value = 50;
            concurrencyInput.value = 10;
            delayMinInput.value = 300;
            delayMaxInput.value = 1500;
            loopModeToggle.checked = false;
            loopCountInput.disabled = true;
            loopCountInput.value = 1;
            loopInfiniteToggle.checked = false;
            loopInfiniteToggle.disabled = true;
            loopCountInput.style.opacity = '';
            loopHint.textContent = 'times';
            loopHint.style.color = '';
            break;
        case 'heavy':
            totalAccessInput.value = 200;
            concurrencyInput.value = 25;
            delayMinInput.value = 100;
            delayMaxInput.value = 800;
            loopModeToggle.checked = true;
            loopCountInput.disabled = false;
            loopCountInput.value = 3;
            loopInfiniteToggle.checked = false;
            loopInfiniteToggle.disabled = false;
            loopCountInput.style.opacity = '';
            loopHint.textContent = 'times';
            loopHint.style.color = '';
            break;
        case 'extreme':
            totalAccessInput.value = 500;
            concurrencyInput.value = 50;
            delayMinInput.value = 0;
            delayMaxInput.value = 300;
            loopModeToggle.checked = true;
            loopCountInput.disabled = true;
            loopCountInput.value = 5;
            loopInfiniteToggle.checked = true;
            loopInfiniteToggle.disabled = false;
            loopCountInput.style.opacity = '0.3';
            loopHint.textContent = '∞ unlimited';
            loopHint.style.color = '#f39c12';
            break;
    }
    addLog(`⚡ Preset "${preset}" applied`, 'warning');
}

// Make applyPreset available globally
window.applyPreset = applyPreset;

// Start button
startBtn.addEventListener('click', () => {
    const urls = parseUrls(targetUrlInput.value);
    const url = urls[0] || ''; // Primary URL for backward compat
    const verifyUrl = verifyUrlInput.value.trim();
    const totalAccess = parseInt(totalAccessInput.value);
    const concurrency = parseInt(concurrencyInput.value);
    const useHeadless = headlessModeToggle.checked;
    const delayMin = parseInt(delayMinInput.value);
    const delayMax = parseInt(delayMaxInput.value);
    const loopMode = loopModeToggle.checked;
    const loopInfinite = loopInfiniteToggle.checked && loopMode;
    const loopCount = loopInfinite ? -1 : (parseInt(loopCountInput.value) || 1);

    // Validation
    if (urls.length === 0) {
        addLog('❌ Please enter at least one valid URL (must start with http:// or https://)', 'error');
        return;
    }

    if (!totalAccess || totalAccess < 1) {
        addLog('❌ Total access must be at least 1', 'error');
        return;
    }

    if (!concurrency || concurrency < 1 || concurrency > 50) {
        addLog('❌ Concurrency must be between 1 and 50', 'error');
        return;
    }

    if (delayMin > delayMax) {
        addLog('❌ Min delay cannot be greater than max delay', 'error');
        return;
    }

    if (proxySource === 'custom' && (!customProxiesTextarea.value.trim())) {
        addLog('❌ Please enter at least one proxy in the custom proxy field', 'error');
        return;
    }

    // Reset stats
    totalRequests = loopInfinite ? Infinity : totalAccess * (loopMode ? loopCount : 1);
    successCount = 0;
    failCount = 0;
    resultRows = 0;
    successfulProxies.clear();
    successfulProxyDetails.length = 0;
    startTime = Date.now();
    updateStats();
    updateCopySuccessButton();

    // Clear previous results
    resultsBody.innerHTML = '';
    resultCount.textContent = '(0)';
    resultRows = 0;

    // Show progress
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressLabel.textContent = loopInfinite ? `0 / ∞` : `0 / ${totalRequests}`;

    // Update UI
    isRunning = true;
    startBtn.disabled = true;
    startBtn.classList.add('running');
    stopBtn.disabled = false;
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';

    // Parse country whitelist
    const countryWhitelist = countryWhitelistInput ? countryWhitelistInput.value.trim().split(',').map(c => c.trim()).filter(c => c) : [];
    const discordWebhook = discordWebhookInput ? discordWebhookInput.value.trim() : '';

    // Emit start event
    const emitData = {
        url,
        urls,
        verifyUrl,
        totalAccess,
        useHeadless,
        concurrency,
        delayMin,
        delayMax,
        loopMode,
        loopCount,
        proxySource,
        countryWhitelist,
        discordWebhook
    };

    // Include custom proxies if using custom source
    if (proxySource === 'custom') {
        emitData.customProxies = customProxiesTextarea.value;
    }

    socket.emit('start-access', emitData);

    const sourceLabel = proxySource === 'custom' ? 'Custom Proxies' : 'Auto-Scrape';
    const loopLabel = loopInfinite ? '∞ unlimited loops' : (loopMode ? loopCount + ' loops' : '1 loop');
    const totalLabel = loopInfinite ? '∞' : totalRequests;
    const urlsLabel = urls.length > 1 ? `${urls.length} URLs (random)` : url;
    addLog(`🚀 Starting traffic: ${totalAccess} requests × ${loopLabel} = ${totalLabel} total`, 'info');
    addLog(`🌐 Target: ${urlsLabel}`, 'info');
    if (urls.length > 1) urls.forEach((u, i) => addLog(`   ${i + 1}. ${u}`, 'info'));
    addLog(`⚡ Concurrency: ${concurrency} | Delay: ${delayMin}-${delayMax}ms | Mode: ${useHeadless ? 'Headless' : 'Visible'} | Proxy: ${sourceLabel}`, 'info');
    if (countryWhitelist.length > 0) {
        addLog(`🌍 Country Whitelist: ${countryWhitelist.join(', ')}`, 'info');
    } else {
        addLog(`🌍 Country Filter: All countries`, 'info');
    }
});

// Stop button
stopBtn.addEventListener('click', () => {
    socket.emit('stop');
    fetch('/api/stop', { method: 'POST' });
    addLog('⛔ Stopping task...', 'warning');
    resetUI();
});

// Clear button
clearBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
    resultsBody.innerHTML = '<tr class="empty-row"><td colspan="7">No results yet. Click "Start Traffic" to begin.</td></tr>';
    resultCount.textContent = '(0)';
    successCount = 0;
    failCount = 0;
    totalRequests = 0;
    resultRows = 0;
    successfulProxies.clear();
    successfulProxyDetails.length = 0;
    updateStats();
    updateCopySuccessButton();
    progressContainer.style.display = 'none';
    statSpeed.textContent = '0';
    statRate.textContent = '0%';
    addLog('🧹 Cleared', 'info');
});

// Socket.IO event handlers
socket.on('log', (data) => {
    let type = 'info';
    if (data.message.includes('✅')) type = 'success';
    else if (data.message.includes('❌')) type = 'error';
    else if (data.message.includes('⚠️') || data.message.includes('⛔')) type = 'warning';

    addLog(data.message, type);
});

socket.on('proxies-count', (data) => {
    statProxies.textContent = data.count;
    if (data.list && Array.isArray(data.list)) {
        allProxiesList = data.list;
    }
    updateCopySuccessButton();
});

socket.on('progress', (data) => {
    const { completed, total, success, failed, isInfinite: isInf, currentLoop: loop, totalCompleted, totalSuccess, totalFailed } = data;

    // Progress bar always shows per-loop progress
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    progressFill.style.opacity = '';
    progressPercent.textContent = `${percent}%`;

    if (isInf) {
        progressLabel.textContent = `${completed} / ${total} (Loop ${loop || '?'})`;
        // Use cumulative stats for infinite mode
        successCount = totalSuccess !== undefined ? totalSuccess : success;
        failCount = totalFailed !== undefined ? totalFailed : failed;
    } else {
        progressLabel.textContent = `${completed} / ${total}`;
        successCount = success;
        failCount = failed;
    }

    updateStats();
    updateSpeed();
});

socket.on('result', (data) => {
    addResultRow(data);
});

socket.on('complete', (data) => {
    addLog(`\n🎉 Task completed! Success: ${data.successCount}, Failed: ${data.failCount}, Total: ${data.total}`, 'success');
    resetUI();
    progressFill.style.width = '100%';
    progressPercent.textContent = '100%';
});

socket.on('error', (data) => {
    addLog(data.message, 'error');
    resetUI();
});

socket.on('disconnect', () => {
    addLog('⚠️ Disconnected from server', 'warning');
    resetUI();
});

socket.on('connect', () => {
    addLog('🔌 Connected to server', 'success');
});

// Helper functions
function addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });

    entry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-message">${escapeHtml(message)}</span>`;

    logContainer.appendChild(entry);

    // Limit log entries to prevent memory issues
    while (logContainer.children.length > 500) {
        logContainer.removeChild(logContainer.firstChild);
    }

    if (autoScrollToggle.checked) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

function addResultRow(data) {
    // Remove empty row if exists
    const emptyRow = resultsBody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    resultRows++;
    resultCount.textContent = `(${resultRows})`;

    const row = document.createElement('tr');
    const statusClass = data.status === 'success' ? 'status-success' : 'status-failed';
    const statusIcon = data.status === 'success' ? '✅' : '❌';

    row.innerHTML = `
        <td>${data.index}</td>
        <td>${escapeHtml(data.proxy)}</td>
        <td>${escapeHtml(data.country || '-')}</td>
        <td class="${statusClass}">${statusIcon}</td>
        <td>${data.statusCode || '-'}</td>
        <td>${data.responseTime ? data.responseTime + 'ms' : '-'}</td>
        <td title="${escapeHtml(data.title || data.error || '-')}">${escapeHtml((data.title || data.error || '-').substring(0, 35))}</td>
    `;

    // Add to top for latest first
    if (resultsBody.firstChild) {
        resultsBody.insertBefore(row, resultsBody.firstChild);
    } else {
        resultsBody.appendChild(row);
    }

    // Limit table rows to prevent memory issues
    while (resultsBody.children.length > 200) {
        resultsBody.removeChild(resultsBody.lastChild);
    }

    if (data.status === 'success' && data.proxy) {
        const proxyStr = String(data.proxy).trim();
        successfulProxies.add(proxyStr);
        // Store detail info
        const proxyFormatted = proxyStr.startsWith('http') ? proxyStr : `http://${proxyStr}`;
        successfulProxyDetails.push({
            proxy: proxyFormatted,
            country: data.country || '-',
            ms: data.responseTime || 0
        });
        updateCopySuccessButton();
    }
}

function updateStats() {
    statTotal.textContent = totalRequests;
    statSuccess.textContent = successCount;
    statFailed.textContent = failCount;

    const total = successCount + failCount;
    const rate = total > 0 ? Math.round((successCount / total) * 100) : 0;
    statRate.textContent = `${rate}%`;
}

function updateSpeed() {
    if (!startTime) return;
    const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
    const total = successCount + failCount;
    const speed = elapsed > 0 ? Math.round(total / elapsed) : 0;
    statSpeed.textContent = speed;
}

function resetUI() {
    isRunning = false;
    startBtn.disabled = false;
    startBtn.classList.remove('running');
    stopBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-play"></i> Start Traffic';
}

function updateCopySuccessButton() {
    const successTotal = successfulProxies.size;
    if (copySuccessBtn) {
        if (successTotal > 0) {
            copySuccessBtn.disabled = false;
            copySuccessBtn.title = `Copy ${successTotal} successful proxies`;
        } else {
            copySuccessBtn.disabled = true;
            copySuccessBtn.title = 'No successful proxies yet';
        }
    }
    if (detailSuccessBtn) {
        if (successTotal > 0) {
            detailSuccessBtn.disabled = false;
            detailSuccessBtn.title = `View ${successTotal} successful proxies detail`;
        } else {
            detailSuccessBtn.disabled = true;
            detailSuccessBtn.title = 'No successful proxies yet';
        }
    }
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!ok) {
        throw new Error('Copy command failed');
    }
}

if (copySuccessBtn) {
    copySuccessBtn.addEventListener('click', async () => {
        // Copy only proxies that were successfully used in http://host:port format
        if (successfulProxyDetails.length > 0) {
            const text = successfulProxyDetails.map(p => p.proxy).join('\n');
            try {
                await copyTextToClipboard(text);
                addLog(`📋 Copied ${successfulProxyDetails.length} successful proxies to clipboard`, 'success');
            } catch (err) {
                addLog(`❌ Failed to copy proxies: ${err.message}`, 'error');
            }
        } else {
            addLog('⚠️ No successful proxies to copy yet', 'warning');
        }
    });
}

// Detail button - show modal with sortable table
if (detailSuccessBtn) {
    detailSuccessBtn.addEventListener('click', () => {
        if (successfulProxyDetails.length === 0) {
            addLog('⚠️ No successful proxies to show yet', 'warning');
            return;
        }
        renderDetailModal();
        detailModal.style.display = 'flex';
    });
}

// Modal close
if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
        detailModal.style.display = 'none';
    });
}

// Close modal on overlay click
if (detailModal) {
    detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) {
            detailModal.style.display = 'none';
        }
    });
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailModal && detailModal.style.display !== 'none') {
        detailModal.style.display = 'none';
    }
});

// Sort handler for detail table
document.querySelectorAll('.modal-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const column = th.dataset.sort;
        if (detailSortColumn === column) {
            detailSortDirection = detailSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            detailSortColumn = column;
            detailSortDirection = 'asc';
        }
        // Update sort indicators
        document.querySelectorAll('.modal-table th.sortable').forEach(h => {
            h.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(detailSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
        renderDetailModal();
    });
});

function renderDetailModal() {
    if (!detailTableBody) return;

    // Sort data
    const sorted = [...successfulProxyDetails].sort((a, b) => {
        let valA, valB;
        switch (detailSortColumn) {
            case 'proxy':
                valA = a.proxy.toLowerCase();
                valB = b.proxy.toLowerCase();
                break;
            case 'country':
                valA = a.country.toLowerCase();
                valB = b.country.toLowerCase();
                break;
            case 'ms':
                valA = Number(a.ms) || 0;
                valB = Number(b.ms) || 0;
                break;
            default:
                valA = a.ms;
                valB = b.ms;
        }
        if (valA < valB) return detailSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return detailSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // Update count
    if (modalProxyCount) {
        modalProxyCount.textContent = `${sorted.length} proxies`;
    }

    // Render rows
    detailTableBody.innerHTML = sorted.map(item => `
        <tr>
            <td>${escapeHtml(item.proxy)}</td>
            <td>${escapeHtml(item.country)}</td>
            <td>${item.ms}ms</td>
        </tr>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update speed every 2 seconds while running
setInterval(() => {
    if (isRunning) {
        updateSpeed();
    }
}, 2000);

updateCopySuccessButton();

// === BACKGROUND MODE ===
const bgModeToggle = document.getElementById('bgModeToggle');
const bgModeLabel = document.getElementById('bgModeLabel');
const bgStatusBar = document.getElementById('bgStatusBar');
const bgStatusIndicator = document.getElementById('bgStatusIndicator');
const bgStatusText = document.getElementById('bgStatusText');
const bgStopBtn = document.getElementById('bgStopBtn');

// Background Monitor Panel elements
const bgMonitorPanel = document.getElementById('bgMonitorPanel');
const bgMonitorPulse = document.getElementById('bgMonitorPulse');
const bgMonitorState = document.getElementById('bgMonitorState');
const bgMonitorStopBtn = document.getElementById('bgMonitorStopBtn');
const bgMonitorResumeBtn = document.getElementById('bgMonitorResumeBtn');
const bgMonitorUrl = document.getElementById('bgMonitorUrl');
const bgMonitorStarted = document.getElementById('bgMonitorStarted');
const bgMonitorLoop = document.getElementById('bgMonitorLoop');
const bgMonitorProxies = document.getElementById('bgMonitorProxies');
const bgMonitorSuccess = document.getElementById('bgMonitorSuccess');
const bgMonitorFailed = document.getElementById('bgMonitorFailed');
const bgMonitorCompleted = document.getElementById('bgMonitorCompleted');
const bgMonitorTarget = document.getElementById('bgMonitorTarget');
const bgMonitorProgressFill = document.getElementById('bgMonitorProgressFill');
const bgMonitorProgressText = document.getElementById('bgMonitorProgressText');
const bgMonitorLogs = document.getElementById('bgMonitorLogs');

let bgLogsShown = 0;

// Check background task status on page load
async function checkBgStatus() {
    try {
        const res = await fetch('/api/background/status');
        const data = await res.json();

        if (data.running) {
            const isInfiniteMode = data.task.loopCount === -1;

            // For infinite mode, show cumulative stats
            const displaySuccess = isInfiniteMode ? (data.task.totalSuccessCount || data.task.successCount) : data.task.successCount;
            const displayFailed = isInfiniteMode ? (data.task.totalFailCount || data.task.failCount) : data.task.failCount;
            const displayCompleted = isInfiniteMode ? (data.task.totalCompletedCount || data.task.completedCount) : data.task.completedCount;

            // Status bar
            bgStatusBar.style.display = 'flex';
            bgStatusIndicator.className = 'bg-status-indicator running';
            bgStatusText.textContent = `Running: ${data.task.url} | ✅${displaySuccess} ❌${displayFailed} (Loop ${data.task.currentLoop})`;
            bgStopBtn.style.display = 'inline-block';

            // Monitor panel
            bgMonitorPanel.style.display = 'block';
            bgMonitorPulse.className = 'bg-pulse';
            bgMonitorState.textContent = '🟢 Running';
            bgMonitorUrl.textContent = data.task.url;
            bgMonitorStarted.textContent = new Date(data.task.startedAt).toLocaleString();
            bgMonitorLoop.textContent = isInfiniteMode ? `${data.task.currentLoop} (∞)` : `${data.task.currentLoop} / ${data.task.loopCount || 1}`;
            bgMonitorProxies.textContent = data.task.proxyCount;
            bgMonitorSuccess.textContent = displaySuccess;
            bgMonitorFailed.textContent = displayFailed;
            bgMonitorCompleted.textContent = displayCompleted;
            bgMonitorTarget.textContent = data.task.totalAccess;

            // Progress - shows per-loop progress
            const total = data.task.totalAccess;
            const completed = data.task.completedCount; // per-loop completed
            if (total > 0) {
                const pct = Math.round((completed / total) * 100);
                bgMonitorProgressFill.style.width = `${pct}%`;
                bgMonitorProgressText.textContent = `${pct}%`;
            }

            // Logs (show new ones)
            if (data.logs && data.logs.length > bgLogsShown) {
                const newLogs = data.logs.slice(bgLogsShown);
                newLogs.forEach(log => {
                    const entry = document.createElement('div');
                    entry.className = `bg-log-entry ${log.type || ''}`;
                    entry.textContent = log.message;
                    bgMonitorLogs.appendChild(entry);
                });
                bgLogsShown = data.logs.length;
                bgMonitorLogs.scrollTop = bgMonitorLogs.scrollHeight;
            }

        } else if (data.task) {
            // Task finished - check if interrupted (resumable)
            const isInterrupted = data.task.interrupted;

            bgStatusBar.style.display = 'flex';
            bgStatusIndicator.className = 'bg-status-indicator stopped';
            bgStopBtn.style.display = 'none';

            if (isInterrupted) {
                bgStatusText.textContent = `⚠️ Interrupted: ✅${data.task.totalSuccessCount || data.task.successCount} ❌${data.task.totalFailCount || data.task.failCount} (Loop ${data.task.currentLoop})`;
            } else {
                bgStatusText.textContent = `Completed: ✅${data.task.successCount} ❌${data.task.failCount}`;
            }

            // Monitor panel - show completed/interrupted state
            bgMonitorPanel.style.display = 'block';
            bgMonitorPulse.className = isInterrupted ? 'bg-pulse stopped' : 'bg-pulse completed';
            bgMonitorState.textContent = isInterrupted ? '⚠️ Interrupted' : '🏁 Completed';
            bgMonitorUrl.textContent = data.task.url;
            bgMonitorStarted.textContent = new Date(data.task.startedAt).toLocaleString();
            bgMonitorLoop.textContent = data.task.currentLoop;
            bgMonitorProxies.textContent = data.task.proxyCount;
            bgMonitorSuccess.textContent = data.task.totalSuccessCount || data.task.successCount;
            bgMonitorFailed.textContent = data.task.totalFailCount || data.task.failCount;
            bgMonitorCompleted.textContent = data.task.totalCompletedCount || data.task.completedCount;
            bgMonitorTarget.textContent = data.task.totalAccess;
            bgMonitorProgressFill.style.width = isInterrupted ? '0%' : '100%';
            bgMonitorProgressText.textContent = isInterrupted ? 'Paused' : '100%';

            // Show resume button if interrupted
            if (bgMonitorResumeBtn) {
                bgMonitorResumeBtn.style.display = isInterrupted ? 'inline-block' : 'none';
            }
            bgMonitorStopBtn.style.display = 'none';
        } else {
            // No task - check for resumable state
            bgStatusBar.style.display = 'none';
            bgMonitorPanel.style.display = 'none';
            if (bgMonitorResumeBtn) bgMonitorResumeBtn.style.display = 'none';
            checkResumableState();
        }
    } catch (e) {
        // ignore
    }
}

// Check on load
checkBgStatus();

// Poll background status every 5 seconds
setInterval(checkBgStatus, 5000);

// Background stop button (status bar)
if (bgStopBtn) {
    bgStopBtn.addEventListener('click', async () => {
        await fetch('/api/background/stop', { method: 'POST' });
        addLog('⏹️ Background task stop requested', 'warning');
        checkBgStatus();
    });
}

// Background stop button (monitor panel)
if (bgMonitorStopBtn) {
    bgMonitorStopBtn.addEventListener('click', async () => {
        await fetch('/api/background/stop', { method: 'POST' });
        addLog('⏹️ Background task stop requested (graceful shutdown)', 'warning');
        bgMonitorPulse.className = 'bg-pulse stopped';
        bgMonitorState.textContent = '⏹️ Stopping...';
        setTimeout(checkBgStatus, 1500);
    });
}

// Background resume button (monitor panel)
if (bgMonitorResumeBtn) {
    bgMonitorResumeBtn.addEventListener('click', async () => {
        bgMonitorResumeBtn.disabled = true;
        bgMonitorResumeBtn.textContent = '⏳ Resuming...';
        try {
            const res = await fetch('/api/background/resume', { method: 'POST' });
            const result = await res.json();
            if (result.success) {
                addLog('🔄 Background task resumed!', 'success');
                bgMonitorResumeBtn.style.display = 'none';
            } else {
                addLog(`❌ Resume failed: ${result.message}`, 'error');
            }
        } catch (err) {
            addLog(`❌ Resume error: ${err.message}`, 'error');
        }
        bgMonitorResumeBtn.disabled = false;
        bgMonitorResumeBtn.innerHTML = '<i class="fas fa-play"></i> Resume';
        setTimeout(checkBgStatus, 1000);
    });
}

// Check for resumable state (shown when no task is running)
async function checkResumableState() {
    try {
        const res = await fetch('/api/background/resumable');
        const data = await res.json();
        if (data.hasResumable && data.info) {
            bgMonitorPanel.style.display = 'block';
            bgMonitorPulse.className = 'bg-pulse stopped';
            bgMonitorState.textContent = '⚠️ Interrupted (Resumable)';
            bgMonitorUrl.textContent = data.info.url || '-';
            bgMonitorLoop.textContent = data.info.currentLoop || '-';
            bgMonitorSuccess.textContent = data.info.totalSuccess || 0;
            bgMonitorFailed.textContent = data.info.totalFailed || 0;
            bgMonitorStarted.textContent = data.info.savedAt ? new Date(data.info.savedAt).toLocaleString() : '-';
            bgMonitorProgressFill.style.width = '0%';
            bgMonitorProgressText.textContent = 'Paused';
            bgMonitorStopBtn.style.display = 'none';
            if (bgMonitorResumeBtn) bgMonitorResumeBtn.style.display = 'inline-block';

            bgStatusBar.style.display = 'flex';
            bgStatusIndicator.className = 'bg-status-indicator stopped';
            bgStatusText.textContent = `⚠️ Resumable: ${data.info.url} (Loop ${data.info.currentLoop})`;
            bgStopBtn.style.display = 'none';
        }
    } catch (e) {
        // ignore
    }
}

// Listen for background events via socket
socket.on('bg-log', (data) => {
    addLog(`[BG] ${data.message}`, data.type || 'info');
    // Also add to monitor panel logs
    if (bgMonitorLogs) {
        const entry = document.createElement('div');
        entry.className = `bg-log-entry ${data.type || ''}`;
        entry.textContent = data.message;
        bgMonitorLogs.appendChild(entry);
        // Keep max 100 entries
        while (bgMonitorLogs.children.length > 100) {
            bgMonitorLogs.removeChild(bgMonitorLogs.firstChild);
        }
        bgMonitorLogs.scrollTop = bgMonitorLogs.scrollHeight;
    }
});

socket.on('bg-result', (data) => {
    addResultRow(data);
});

socket.on('bg-progress', (data) => {
    progressContainer.style.display = 'block';
    const { completed, total, success, failed, isInfinite, currentLoop, totalCompleted, totalSuccess, totalFailed } = data;

    // Progress bar always shows per-loop progress (completed/total per loop)
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    progressFill.style.opacity = '';
    progressPercent.textContent = `${percent}%`;

    if (isInfinite) {
        progressLabel.textContent = `${completed} / ${total} (Loop ${currentLoop || '?'})`;
        // Show cumulative stats for infinite mode
        const displaySuccess = totalSuccess !== undefined ? totalSuccess : success;
        const displayFailed = totalFailed !== undefined ? totalFailed : failed;
        const displayCompleted = totalCompleted !== undefined ? totalCompleted : completed;
        statTotal.textContent = displayCompleted;
        statSuccess.textContent = displaySuccess;
        statFailed.textContent = displayFailed;
        if (displayCompleted > 0) {
            statRate.textContent = `${Math.round((displaySuccess / displayCompleted) * 100)}%`;
        }
    } else {
        progressLabel.textContent = `${completed} / ${total}`;
        statTotal.textContent = completed;
        statSuccess.textContent = success;
        statFailed.textContent = failed;
        if (completed > 0) {
            statRate.textContent = `${Math.round((success / completed) * 100)}%`;
        }
    }

    // Update monitor panel stats in real-time
    if (bgMonitorPanel && bgMonitorPanel.style.display !== 'none') {
        if (isInfinite) {
            const displaySuccess = totalSuccess !== undefined ? totalSuccess : success;
            const displayFailed = totalFailed !== undefined ? totalFailed : failed;
            const displayCompleted = totalCompleted !== undefined ? totalCompleted : completed;
            bgMonitorSuccess.textContent = displaySuccess;
            bgMonitorFailed.textContent = displayFailed;
            bgMonitorCompleted.textContent = displayCompleted;
            bgMonitorTarget.textContent = total;
        } else {
            bgMonitorSuccess.textContent = success;
            bgMonitorFailed.textContent = failed;
            bgMonitorCompleted.textContent = completed;
            bgMonitorTarget.textContent = total;
        }
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        bgMonitorProgressFill.style.width = `${pct}%`;
        bgMonitorProgressText.textContent = `${pct}%`;

        if (currentLoop) {
            bgMonitorLoop.textContent = isInfinite ? `${currentLoop} (∞)` : currentLoop;
        }
    }
});

socket.on('bg-complete', (data) => {
    addLog(`🏁 Background task completed: ✅${data.successCount} ❌${data.failCount}`, 'success');
    checkBgStatus();
});

// Override start button to support background mode
const originalStartHandler = startBtn.onclick;
startBtn.addEventListener('click', async (e) => {
    if (!bgModeToggle || !bgModeToggle.checked) return; // Let normal handler work

    e.stopImmediatePropagation();
    e.preventDefault();

    const urls = parseUrls(targetUrlInput.value);
    const url = urls[0] || '';
    if (urls.length === 0) {
        addLog('❌ Please enter at least one valid target URL', 'error');
        return;
    }

    successfulProxies.clear();
    successfulProxyDetails.length = 0;
    updateCopySuccessButton();

    const verifyUrl = verifyUrlInput.value.trim();
    const totalAccess = parseInt(totalAccessInput.value) || 100;
    const concurrency = parseInt(concurrencyInput.value) || 5;
    const useHeadless = headlessModeToggle.checked;
    const delayMin = parseInt(delayMinInput.value) || 500;
    const delayMax = parseInt(delayMaxInput.value) || 2000;
    const loopMode = loopModeToggle.checked;
    const loopInfinite = loopInfiniteToggle.checked && loopMode;
    const loopCount = loopInfinite ? -1 : (parseInt(loopCountInput.value) || 1);
    const proxySource = document.querySelector('.proxy-tab.active')?.dataset?.source || 'auto';

    // Parse country whitelist for background mode
    const countryWhitelistBg = countryWhitelistInput ? countryWhitelistInput.value.trim().split(',').map(c => c.trim()).filter(c => c) : [];
    const discordWebhookBg = discordWebhookInput ? discordWebhookInput.value.trim() : '';

    const body = {
        url,
        urls,
        verifyUrl,
        totalAccess,
        useHeadless,
        concurrency,
        delayMin,
        delayMax,
        loopMode,
        loopCount,
        proxySource,
        countryWhitelist: countryWhitelistBg,
        discordWebhook: discordWebhookBg
    };

    if (proxySource === 'custom') {
        body.customProxies = customProxiesTextarea.value;
    }

    try {
        const res = await fetch('/api/background/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await res.json();

        if (result.success) {
            addLog('🖥️ Background task started! You can close this browser - task will keep running on server.', 'success');
            checkBgStatus();
        } else {
            addLog(`❌ ${result.message}`, 'error');
        }
    } catch (err) {
        addLog(`❌ Failed to start background task: ${err.message}`, 'error');
    }
}, true); // Use capture phase to intercept before normal handler

// === PROXY CACHE STATUS ===
const cacheStatusBar = document.getElementById('cacheStatusBar');
const cacheStatusText = document.getElementById('cacheStatusText');
const cacheRefreshBtn = document.getElementById('cacheRefreshBtn');

async function updateCacheStatus() {
    try {
        const res = await fetch('/api/cache/status');
        const data = await res.json();

        if (data.cachedCount > 0 && data.isValid) {
            const ageMin = Math.floor(data.cacheAge / 60);
            const ageSec = data.cacheAge % 60;
            const remaining = Math.ceil(data.ttlRemaining / 1000);
            const remainMin = Math.floor(remaining / 60);
            cacheStatusText.textContent = `Cache: ${data.cachedCount} proxies | Age: ${ageMin}m ${ageSec}s | Refresh in: ${remainMin}m | Hits: ${data.hits}`;
            cacheStatusBar.className = 'cache-status-bar cache-fresh';
        } else if (data.cachedCount > 0 && !data.isValid) {
            cacheStatusText.textContent = `Cache: expired (${data.cachedCount} proxies) | Will refresh on next run`;
            cacheStatusBar.className = 'cache-status-bar cache-expired';
        } else {
            cacheStatusText.textContent = 'Cache: empty (will scrape on first run)';
            cacheStatusBar.className = 'cache-status-bar';
        }
    } catch (err) {
        cacheStatusText.textContent = 'Cache: unable to fetch status';
    }
}

if (cacheRefreshBtn) {
    cacheRefreshBtn.addEventListener('click', async () => {
        cacheRefreshBtn.classList.add('spinning');
        try {
            await fetch('/api/cache/clear', { method: 'POST' });
            addLog('🗑️ Proxy cache cleared. Fresh proxies will be scraped on next run.', 'info');
            await updateCacheStatus();
        } catch (err) {
            addLog('❌ Failed to clear cache', 'error');
        }
        cacheRefreshBtn.classList.remove('spinning');
    });
}

// Update cache status on load and periodically
updateCacheStatus();
setInterval(updateCacheStatus, 30000); // Update every 30s
