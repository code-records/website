import React from 'react';
import { oauth2Client } from '../oauth2';
import { gitlabCICDStore } from './GitlabCICDStore';

export default class GitlabCICD extends React.Component {
    constructor(props) {
        super(props);
        this.state = gitlabCICDStore.state;
        this.unsubscribe = null;
    }

    componentDidMount() {
        this.unsubscribe = gitlabCICDStore.subscribe((state) => {
            this.setState(state);
        });
    }

    componentWillUnmount() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }

    fetchStatus = (forceUntil = 0) => {
        gitlabCICDStore.forceRefresh(forceUntil - Date.now());
    };

    render() {
        const { pipeline, jobs, loading, elapsedTime } = this.state;
        const { showHint = true, hideIdle = false, className = '' } = this.props;

        if (!oauth2Client.isLoggedIn()) return null;

        if (loading && !pipeline) return null;

        const isProcessing = pipeline && ['running', 'pending'].includes(pipeline.status);

        if (hideIdle && !isProcessing) return null;

        const stageDotColor = (status) => {
            if (status === 'success') return 'border-[#1aaa55]';
            if (status === 'running') return 'border-[#1f78d1]';
            if (status === 'failed') return 'border-[#db3b21]';
            return 'border-[#919191]';
        };

        const stageLineColor = (status) => {
            if (status === 'success') return 'bg-[#1aaa55]';
            if (status === 'running') return 'bg-[#1f78d1]';
            if (status === 'failed') return 'bg-[#db3b21]';
            return 'bg-[#919191]';
        };

        return (
            <div className={`inline-flex items-center gap-3 px-3 py-1 rounded-[20px] border transition-all duration-300 ${isProcessing ? 'bg-[#f0f7ff] border-[#1f78d1]/20' : 'bg-[#f8f8f8] border-[#e8e8e8]'} ${className}`}>
                {pipeline && (
                    <a
                        href="http://gitlab.sh.com/platform/frontend/docs.dobest.cn/pipelines"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="no-underline flex items-center transition-transform duration-200 hover:scale-105"
                        title={`最近一次构建: #${pipeline.id} (点击查看详情)`}
                    >
                        <div className="flex items-center">
                            {jobs.map((job, index) => (
                                <React.Fragment key={job.id}>
                                    <div className={`w-[22px] h-[22px] flex items-center justify-center rounded-full bg-white border-[1.5px] relative z-[2] box-border ${stageDotColor(job.status)}`} title={`${job.name}: ${job.status}`}>
                                        {job.status === 'running' && <div className="w-3 h-3 border-2 border-[#1f78d1] border-t-transparent rounded-full animate-rotate-spin" />}
                                        {job.status === 'success' && <div className="w-2 h-2 bg-[#1aaa55] rounded-full" />}
                                        {job.status === 'failed' && <span className="text-[#db3b21] text-xs font-bold leading-none">×</span>}
                                        {(job.status === 'pending' || job.status === 'created') && <div className="w-2 h-2 bg-[#919191] rounded-full" />}
                                    </div>
                                    {index < jobs.length - 1 && (
                                        <div className={`w-2.5 h-0.5 z-[1] ${stageLineColor(job.status)}`} />
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </a>
                )}

                <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#595959]">
                        {isProcessing ? '正在构建发布' : '暂无发布任务'}
                        {isProcessing && elapsedTime && <span className="text-[#1f78d1] [font-variant-numeric:tabular-nums]"> ({elapsedTime})</span>}
                    </span>

                    {isProcessing && showHint && (
                        <span className="text-[11px] text-white bg-[#1f78d1] px-1.5 py-px rounded-[10px] tracking-[0.5px] animate-flash-hint">请勿重复操作</span>
                    )}
                </div>
            </div>
        );
    }
}
