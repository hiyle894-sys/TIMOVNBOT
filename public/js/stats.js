/**
 * Stats Cards Controller & Counter Animations
 */

class StatsManager {
    static animateNumber(element, start, end, duration = 800) {
        if (!element) return;
        const startTime = performance.now();
        const startVal = parseInt(start, 10) || 0;
        const endVal = parseInt(end, 10) || 0;

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out quad formula
            const easeProgress = progress * (2 - progress);
            const currentVal = Math.floor(startVal + (endVal - startVal) * easeProgress);
            
            element.textContent = currentVal;

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                element.textContent = endVal;
            }
        }

        requestAnimationFrame(update);
    }

    static updateStatsDisplay(stats) {
        const totalEl = document.getElementById('stat-total');
        const durEl = document.getElementById('stat-duration');
        const compEl = document.getElementById('stat-completed');

        if (totalEl) {
            const curTotal = parseInt(totalEl.textContent, 10) || 0;
            this.animateNumber(totalEl, curTotal, stats.totalCount || 0);
        }

        if (compEl) {
            const curComp = parseInt(compEl.textContent, 10) || 0;
            this.animateNumber(compEl, curComp, stats.completedCount || 0);
        }

        if (durEl) {
            durEl.textContent = stats.durationText || '0h 0m';
        }
    }
}
