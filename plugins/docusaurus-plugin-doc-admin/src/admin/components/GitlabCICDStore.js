/**
 * GitlabCICDStore.js
 *
 * 一个单例状态管理器，用于在多处同步 GitLab CI/CD 构建状态，
 * 避免多个组件同时发起重复的轮询请求。
 */
import { oauth2Client } from '../oauth2';

class GitlabCICDStore {
    constructor() {
        this.state = {
            pipeline: null,
            jobs: [],
            loading: true,
            elapsedTime: '',
            isPolling: false,
        };
        this.listeners = new Set();
        this.timer = null;
        this.clockTimer = null;
        this._startTime = null;
        this._forcePollUntil = 0;
    }

    // 订阅状态变更
    subscribe(listener) {
        this.listeners.add(listener);
        // 初始触发
        listener(this.state);
        
        // 如果是第一个订阅者，且还未开始轮询，则启动初次加载
        if (this.listeners.size === 1) {
            this.fetchStatus();
        }

        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0) {
                this.stopPolling();
                this.stopClock();
            }
        };
    }

    notify() {
        this.listeners.forEach(listener => listener(this.state));
    }

    updateState(newState) {
        this.state = { ...this.state, ...newState };
        this.notify();
    }

    /**
     * 外部手动强制刷新 (如提交代码后)
     * @param {number} duration 强制持续轮询的时间 (ms)
     */
    forceRefresh(duration = 10000) {
        const until = Date.now() + duration;
        this._forcePollUntil = Math.max(this._forcePollUntil, until);
        this.fetchStatus();
    }

    async fetchStatus() {
        // 未登录则不执行任何操作
        if (!oauth2Client.isLoggedIn()) {
            this.updateState({ loading: false });
            return;
        }

        try {
            const pipeline = await oauth2Client.getLatestPipeline();
            if (!pipeline) {
                this.updateState({ pipeline: null, loading: false });
                return;
            }

            this.updateState({ pipeline, loading: false });
            this.updateJobsData(pipeline.id, pipeline.status);

            const isProcessing = ['running', 'pending'].includes(pipeline.status);
            const now = Date.now();

            if (isProcessing || now < this._forcePollUntil) {
                this.startPolling();
                this.startClock(pipeline.created_at);
            } else {
                this.stopPolling();
                this.stopClock();
            }
        } catch (err) {
            console.error('[GitlabCICDStore] Failed to fetch status:', err);
            this.updateState({ loading: false });
        }
    }

    async updateJobsData(pipelineId, pipelineStatus) {
        try {
            const jobs = await oauth2Client.getPipelineJobs(pipelineId);
            if (!Array.isArray(jobs)) return;

            this.updateState({ jobs });

            // 寻找最早的触发/开始时间，用于精准计时
            if (pipelineStatus === 'running' || pipelineStatus === 'pending') {
                const runningJob = jobs.find(j => j.started_at);
                if (runningJob && runningJob.started_at) {
                    this.startClock(runningJob.started_at);
                }
            }
        } catch (err) {
            console.error('[GitlabCICDStore] Failed to update jobs data:', err);
        }
    }

    startPolling() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.fetchStatus();
        }, 5000); 
        this.state.isPolling = true;
    }

    stopPolling() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.state.isPolling = false;
    }

    startClock(timeStr) {
        const timestamp = new Date(timeStr).getTime();
        if (isNaN(timestamp)) return;

        this._startTime = timestamp;

        if (this.clockTimer) return;

        const updateClock = () => {
            const now = Date.now();
            const diff = Math.floor((now - this._startTime) / 1000);
            if (diff < 0) return;

            const mins = Math.floor(diff / 60);
            const secs = diff % 60;
            const elapsedTime = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
            
            if (elapsedTime !== this.state.elapsedTime) {
                this.updateState({ elapsedTime });
            }
        };

        updateClock();
        this.clockTimer = setInterval(updateClock, 1000);
    }

    stopClock() {
        if (this.clockTimer) {
            clearInterval(this.clockTimer);
            this.clockTimer = null;
        }
    }
}

// 导出单例
export const gitlabCICDStore = new GitlabCICDStore();
