/**
 * Main Web Application Controller for TimeBot
 */

document.addEventListener('DOMContentLoaded', () => {
    let currentFilterDate = 'all'; // 'all', 'today', 'tomorrow', or 'YYYY-MM-DD'
    let searchQuery = '';
    let isInitialLoad = true;
    let wizardModal = null;

    // Toast Notification System
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // Live Real-time Clock
    function updateLiveClock() {
        const timeEl = document.getElementById('sidebar-time');
        const dateEl = document.getElementById('sidebar-date');
        if (!timeEl || !dateEl) return;

        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();

        timeEl.textContent = `${hours}:${minutes}:${seconds}`;
        dateEl.textContent = `${day}/${month}/${year}`;
    }

    setInterval(updateLiveClock, 1000);
    updateLiveClock();

    // Navigation System
    function switchTab(targetId) {
        document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
            if (item.dataset.target === targetId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        document.querySelectorAll('.page-view').forEach(page => {
            if (page.id === targetId) {
                page.classList.add('active');
            } else {
                page.classList.remove('active');
            }
        });

        const headerTitle = document.getElementById('header-page-title');
        if (headerTitle) {
            headerTitle.textContent = targetId === 'home-page' ? 'Trang chủ' : 'Cài đặt';
        }

        if (targetId === 'settings-page') {
            SettingsController.loadSettings();
        }
    }

    document.querySelectorAll('[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget.dataset.target;
            if (target) switchTab(target);
        });
    });

    // Initialize 5-Step Creation Wizard Modal
    wizardModal = new CreationModalWizard(async (draftData) => {
        try {
            await TimeBotAPI.createSchedule(draftData);
            showToast('✅ Đã tạo lịch thành công & đồng bộ Telegram!', 'success');
            loadSchedulesAndStats();
        } catch (err) {
            showToast('❌ Lỗi khi tạo lịch: ' + err.message, 'error');
        }
    });

    document.getElementById('btn-open-create-modal')?.addEventListener('click', () => wizardModal.open());
    document.getElementById('btn-empty-add')?.addEventListener('click', () => wizardModal.open());
    document.getElementById('btn-mobile-add')?.addEventListener('click', () => wizardModal.open());

    // Search and Date Filters
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            renderFilteredSchedules();
        });
    }

    // Filter Pills
    document.querySelectorAll('.filter-pills .pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-pills .pill-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById('filter-custom-date').value = '';

            const dateType = e.target.dataset.date;
            const now = new Date();
            if (dateType === 'all') {
                currentFilterDate = 'all';
            } else if (dateType === 'today') {
                currentFilterDate = now.toISOString().split('T')[0];
            } else if (dateType === 'tomorrow') {
                const tmr = new Date(now);
                tmr.setDate(tmr.getDate() + 1);
                currentFilterDate = tmr.toISOString().split('T')[0];
            }
            loadSchedulesAndStats();
        });
    });

    // Custom Date Picker Filter
    const customDateInput = document.getElementById('filter-custom-date');
    if (customDateInput) {
        customDateInput.addEventListener('change', (e) => {
            if (e.target.value) {
                document.querySelectorAll('.filter-pills .pill-btn').forEach(b => b.classList.remove('active'));
                currentFilterDate = e.target.value;
                loadSchedulesAndStats();
            }
        });
    }

    // Data Cache
    let cachedSchedules = [];

    async function loadSchedulesAndStats() {
        const skeleton = document.getElementById('skeleton-loader');
        const emptyState = document.getElementById('empty-state');
        const scheduleList = document.getElementById('schedule-list');

        if (isInitialLoad && skeleton) skeleton.classList.remove('hidden');

        try {
            const filters = {};
            if (currentFilterDate !== 'all') {
                filters.date = currentFilterDate;
            }

            const [schedulesData, statsData] = await Promise.all([
                TimeBotAPI.fetchSchedules(filters),
                TimeBotAPI.fetchStats()
            ]);

            cachedSchedules = schedulesData;

            // Update Animated Stats
            StatsManager.updateStatsDisplay(statsData);

            // Render Schedule Cards
            renderFilteredSchedules();

        } catch (err) {
            console.error('Error loading data:', err);
            showToast('⚠️ Không thể tải dữ liệu từ máy chủ', 'error');
        } finally {
            if (skeleton) skeleton.classList.add('hidden');
            isInitialLoad = false;
        }
    }

    function renderFilteredSchedules() {
        const emptyState = document.getElementById('empty-state');
        const scheduleList = document.getElementById('schedule-list');
        if (!scheduleList) return;

        let filtered = cachedSchedules;
        if (searchQuery) {
            filtered = filtered.filter(s => s.title.toLowerCase().includes(searchQuery));
        }

        if (filtered.length === 0) {
            scheduleList.innerHTML = '';
            emptyState?.classList.remove('hidden');
            return;
        }

        emptyState?.classList.add('hidden');
        scheduleList.innerHTML = '';

        filtered.forEach(s => {
            const card = document.createElement('div');
            const isCompleted = s.completed || s.status === 'completed';
            
            card.className = `schedule-card glass-card ${isCompleted ? 'completed-card' : ''}`;
            card.id = `schedule-card-${s.id}`;

            const badgeText = s.status === 'completed' ? '✅ Đã hoàn thành' :
                              s.status === 'running' ? '🔵 Đang diễn ra' :
                              s.status === 'ended' ? '⚪ Đã kết thúc' : '🟢 Sắp tới';

            const badgeClass = s.status;

            const [y, m, d] = s.date.split('-');
            const formattedDate = `${d}/${m}/${y}`;

            // Calculate duration label
            const h = Math.floor(s.duration / 60);
            const min = s.duration % 60;
            const durText = h > 0 ? (min > 0 ? `${h}h ${min}m` : `${h} giờ`) : `${min} phút`;

            card.innerHTML = `
                <div class="card-top">
                    <h4 class="card-title">📚 ${escapeHtml(s.title)}</h4>
                    <span class="status-badge ${badgeClass}">${badgeText}</span>
                </div>

                <div class="card-info-rows">
                    <div class="info-row">
                        <span>📅</span> <strong>${formattedDate}</strong>
                    </div>
                    <div class="info-row">
                        <span>🕐</span> <span>${s.startTime} → ${s.endTime}</span>
                        <span style="opacity: 0.6; font-size: 12px;">(${durText})</span>
                    </div>
                    <div class="info-row">
                        <span>🔔</span> <span>Báo trước ${s.reminderMinutes} phút</span>
                    </div>
                </div>

                <div class="card-bottom-actions">
                    <label class="custom-checkbox">
                        <input type="checkbox" ${isCompleted ? 'checked disabled' : ''} data-action="toggle-complete" data-id="${s.id}">
                        <span class="checkmark"></span>
                        <span>Hoàn thành</span>
                    </label>

                    <div class="action-btns-right">
                        ${!isCompleted ? `
                            <button class="btn btn-secondary btn-xs" data-action="extend-10" data-id="${s.id}" title="Gia hạn +10 phút">
                                ➕ 10m
                            </button>
                        ` : ''}
                        <button class="btn btn-secondary btn-xs" data-action="delete" data-id="${s.id}" title="Hủy lịch">
                            🗑️
                        </button>
                    </div>
                </div>
            `;

            scheduleList.appendChild(card);
        });

        attachCardEventHandlers();
    }

    function attachCardEventHandlers() {
        // Toggle Complete
        document.querySelectorAll('[data-action="toggle-complete"]').forEach(chk => {
            chk.addEventListener('change', async (e) => {
                const id = e.target.dataset.id;
                const card = document.getElementById(`schedule-card-${id}`);
                
                if (card) {
                    card.classList.add('completed-card');
                }

                try {
                    await TimeBotAPI.updateSchedule(id, { completed: true, status: 'completed' });
                    showToast('✅ Đã hoàn thành lịch trình!', 'success');
                    loadSchedulesAndStats();
                } catch (err) {
                    showToast('❌ Lỗi khi cập nhật trạng thái: ' + err.message, 'error');
                }
            });
        });

        // Extend +10m
        document.querySelectorAll('[data-action="extend-10"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                const sched = cachedSchedules.find(x => x.id == id);
                if (!sched) return;

                // Add 10 mins to end time
                const [h, m] = sched.endTime.split(':').map(Number);
                const dt = new Date();
                dt.setHours(h, m + 10, 0);
                const newEnd = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

                try {
                    await TimeBotAPI.updateSchedule(id, { endTime: newEnd });
                    showToast('➕ Đã gia hạn +10 phút!', 'success');
                    loadSchedulesAndStats();
                } catch (err) {
                    showToast('❌ Lỗi khi gia hạn: ' + err.message, 'error');
                }
            });
        });

        // Delete Schedule
        document.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                const card = document.getElementById(`schedule-card-${id}`);
                
                if (card) {
                    card.style.transform = 'scale(0.9) translateY(10px)';
                    card.style.opacity = '0';
                    card.style.transition = 'all 0.3s ease';
                }

                setTimeout(async () => {
                    try {
                        await TimeBotAPI.deleteSchedule(id);
                        showToast('🗑️ Đã xóa lịch trình', 'info');
                        loadSchedulesAndStats();
                    } catch (err) {
                        showToast('❌ Lỗi khi xóa lịch: ' + err.message, 'error');
                    }
                }, 300);
            });
        });
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // Initialize Settings Page Events
    SettingsController.initEvents(showToast);

    // Initial Load
    loadSchedulesAndStats();

    // Subscribe to Server-Sent Events (SSE Real-time Sync)
    TimeBotAPI.subscribeRealtime((type, payload) => {
        console.log('Realtime Event Received:', type, payload);
        loadSchedulesAndStats();
        if (type === 'schedule_change' && payload.data?.action === 'create') {
            showToast('🔔 Lịch mới đã được tạo từ Telegram!', 'info');
        }
    });
});
