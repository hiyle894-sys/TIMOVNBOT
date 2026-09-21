/**
 * 5-Step Schedule Creation Modal Wizard Controller
 */

class CreationModalWizard {
    constructor(onComplete) {
        this.onComplete = onComplete;
        this.currentStep = 1;
        this.draft = {
            title: '',
            date: '',
            startTime: '',
            endTime: '',
            reminderMinutes: 15
        };

        this.initDOM();
    }

    initDOM() {
        this.backdrop = document.getElementById('create-modal-backdrop');
        this.btnClose = document.getElementById('btn-close-modal');
        this.btnBack = document.getElementById('btn-modal-back');
        this.btnNext = document.getElementById('btn-modal-next');
        this.btnConfirm = document.getElementById('btn-modal-confirm');

        // Step inputs
        this.inputTitle = document.getElementById('input-step-title');
        this.inputDate = document.getElementById('input-step-date');
        this.inputStart = document.getElementById('input-step-starttime');
        this.inputEnd = document.getElementById('input-step-endtime');

        // Quick date buttons
        document.getElementById('btn-date-today').addEventListener('click', () => {
            const today = new Date().toISOString().split('T')[0];
            this.inputDate.value = today;
            this.goToStep(3);
        });

        document.getElementById('btn-date-tomorrow').addEventListener('click', () => {
            const tmr = new Date();
            tmr.setDate(tmr.getDate() + 1);
            this.inputDate.value = tmr.toISOString().split('T')[0];
            this.goToStep(3);
        });

        // Quick duration buttons
        document.querySelectorAll('.quick-duration-grid .btn-chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mins = parseInt(e.target.dataset.dur, 10);
                if (this.draft.startTime) {
                    const [h, m] = this.draft.startTime.split(':').map(Number);
                    const dt = new Date();
                    dt.setHours(h, m + mins, 0);
                    const resH = String(dt.getHours()).padStart(2, '0');
                    const resM = String(dt.getMinutes()).padStart(2, '0');
                    this.inputEnd.value = `${resH}:${resM}`;
                    this.goToStep(5);
                }
            });
        });

        // Quick reminder buttons
        document.querySelectorAll('.quick-reminder-grid .btn-chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.quick-reminder-grid .btn-chip').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.draft.reminderMinutes = parseInt(e.target.dataset.rem, 10);
            });
        });

        // Event listeners
        this.btnClose.addEventListener('click', () => this.hide());
        this.btnBack.addEventListener('click', () => this.prevStep());
        this.btnNext.addEventListener('click', () => this.nextStep());
        this.btnConfirm.addEventListener('click', () => this.submit());

        // Quick time input normalization (e.g., 1700 -> 17:00)
        this.inputStart.addEventListener('blur', () => this.formatTimeInput(this.inputStart));
        this.inputEnd.addEventListener('blur', () => this.formatTimeInput(this.inputEnd));
    }

    formatTimeInput(inputEl) {
        let val = inputEl.value.trim();
        if (/^\d{3,4}$/.test(val)) {
            if (val.length === 3) val = '0' + val;
            inputEl.value = `${val.substring(0, 2)}:${val.substring(2, 4)}`;
        }
    }

    open() {
        this.currentStep = 1;
        this.draft = {
            title: '',
            date: new Date().toISOString().split('T')[0],
            startTime: '17:00',
            endTime: '18:00',
            reminderMinutes: 15
        };

        this.inputTitle.value = '';
        this.inputDate.value = this.draft.date;
        this.inputStart.value = this.draft.startTime;
        this.inputEnd.value = this.draft.endTime;

        this.backdrop.classList.remove('hidden');
        this.updateStepUI();
    }

    hide() {
        this.backdrop.classList.add('hidden');
    }

    goToStep(step) {
        if (!this.validateStep(this.currentStep)) return;
        this.currentStep = step;
        this.updateStepUI();
    }

    nextStep() {
        if (!this.validateStep(this.currentStep)) return;
        if (this.currentStep < 5) {
            this.currentStep++;
            this.updateStepUI();
        } else if (this.currentStep === 5) {
            this.currentStep = 6; // Confirm step
            this.updateStepUI();
        }
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateStepUI();
        }
    }

    validateStep(step) {
        if (step === 1) {
            const val = this.inputTitle.value.trim();
            if (!val) {
                alert('Vui lòng nhập tên lịch trình!');
                return false;
            }
            this.draft.title = val;
        } else if (step === 2) {
            const val = this.inputDate.value.trim();
            if (!val) {
                alert('Vui lòng chọn ngày!');
                return false;
            }
            this.draft.date = val;
        } else if (step === 3) {
            this.formatTimeInput(this.inputStart);
            const val = this.inputStart.value.trim();
            if (!/^\d{2}:\d{2}$/.test(val)) {
                alert('Vui lòng nhập giờ bắt đầu đúng định dạng (Ví dụ: 17:00)!');
                return false;
            }
            this.draft.startTime = val;
        } else if (step === 4) {
            this.formatTimeInput(this.inputEnd);
            const val = this.inputEnd.value.trim();
            if (!/^\d{2}:\d{2}$/.test(val)) {
                alert('Vui lòng nhập giờ kết thúc đúng định dạng (Ví dụ: 18:00)!');
                return false;
            }
            this.draft.endTime = val;
        }
        return true;
    }

    updateStepUI() {
        // Update nodes
        document.querySelectorAll('.step-node').forEach(node => {
            const stepNum = parseInt(node.dataset.step, 10);
            if (stepNum <= Math.min(this.currentStep, 5)) {
                node.classList.add('active');
            } else {
                node.classList.remove('active');
            }
        });

        // Hide all views
        document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));

        if (this.currentStep <= 5) {
            const stepEl = document.getElementById(`modal-step-${this.currentStep}`);
            if (stepEl) stepEl.classList.add('active');
            this.btnNext.classList.remove('hidden');
            this.btnConfirm.classList.add('hidden');
        } else {
            // Confirm step
            document.getElementById('modal-step-confirm').classList.add('active');
            this.btnNext.classList.add('hidden');
            this.btnConfirm.classList.remove('hidden');
            this.renderSummary();
        }

        // Back button visibility
        if (this.currentStep === 1) {
            this.btnBack.style.visibility = 'hidden';
        } else {
            this.btnBack.style.visibility = 'visible';
        }
    }

    renderSummary() {
        document.getElementById('confirm-val-title').textContent = this.draft.title;
        const [y, m, d] = this.draft.date.split('-');
        document.getElementById('confirm-val-date').textContent = `${d}/${m}/${y}`;
        document.getElementById('confirm-val-timerange').textContent = `${this.draft.startTime} → ${this.draft.endTime}`;
        
        // Duration
        const [h1, m1] = this.draft.startTime.split(':').map(Number);
        const [h2, m2] = this.draft.endTime.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        const durH = Math.floor(mins / 60);
        const durM = mins % 60;
        const durText = durH > 0 ? (durM > 0 ? `${durH} giờ ${durM} phút` : `${durH} giờ`) : `${durM} phút`;
        document.getElementById('confirm-val-duration').textContent = durText;

        document.getElementById('confirm-val-reminder').textContent = `${this.draft.reminderMinutes} phút`;

        // Computed Reminder Time
        const dt = new Date(`${this.draft.date}T${this.draft.startTime}:00`);
        dt.setMinutes(dt.getMinutes() - this.draft.reminderMinutes);
        const remH = String(dt.getHours()).padStart(2, '0');
        const remM = String(dt.getMinutes()).padStart(2, '0');
        document.getElementById('confirm-val-remindertime').textContent = `${remH}:${remM}`;
    }

    async submit() {
        if (this.onComplete) {
            await this.onComplete(this.draft);
        }
        this.hide();
    }
}
