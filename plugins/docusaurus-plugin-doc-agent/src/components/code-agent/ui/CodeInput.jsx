import React from 'react';

export default function CodeInput({
    inputRef,
    inputValue,
    model,
    modelOptions,
    isLoading,
    onInputChange,
    onKeyDown,
    onSend,
    onStop,
    onModelChange,
}) {
    return (
        <div className="px-6 py-4 border-t border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-color-emphasis-100)] shrink-0">
            <div className="flex items-end gap-3 bg-[var(--ifm-background-color)] border border-[var(--ifm-color-emphasis-200)] rounded-xl pl-4 pr-1.5 py-1.5 transition-colors focus-within:border-[var(--ifm-color-primary)] focus-within:shadow-[0_0_12px_rgba(var(--ifm-color-primary-rgb),0.05)]">
                <textarea
                    ref={inputRef}
                    className="flex-1 border-none bg-transparent text-[var(--ifm-font-color-base)] text-xs leading-normal py-2.5 resize-none outline-none font-mono placeholder-[var(--ifm-color-emphasis-500)] overflow-y-auto [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-[var(--ifm-color-emphasis-300)] [&::-webkit-scrollbar-thumb]:rounded"
                    value={inputValue}
                    onChange={onInputChange}
                    onKeyDown={onKeyDown}
                    placeholder="向 CodeAgent 提问，输入文件重构、改写指令..."
                    rows={1}
                    disabled={isLoading}
                />
                {isLoading ? (
                    <button
                        onClick={onStop}
                        className="w-8 h-8 rounded-lg border-none flex items-center justify-center cursor-pointer bg-[var(--ifm-color-emphasis-200)] text-[var(--ifm-color-emphasis-600)] hover:bg-[var(--ifm-color-emphasis-300)] transition-all shrink-0"
                        title="停止生成"
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="1.5" />
                        </svg>
                    </button>
                ) : (
                    <button
                        onClick={onSend}
                        disabled={!inputValue.trim()}
                        className={`w-8 h-8 rounded-lg border-none flex items-center justify-center cursor-pointer transition-all shrink-0 ${inputValue.trim()
                            ? 'bg-[var(--ifm-color-primary)] text-white hover:opacity-90 shadow-md shadow-[var(--ifm-color-primary-light)]'
                            : 'bg-[var(--ifm-color-emphasis-200)] text-[var(--ifm-color-emphasis-400)] cursor-not-allowed'
                            }`}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    </button>
                )}
            </div>

            <div className="flex items-center justify-between mt-3 text-[10px] text-[var(--ifm-color-emphasis-500)]">
                <label className="flex items-center gap-1.5">
                    <span>MODEL SELECT:</span>
                    <select
                        className="h-6 rounded border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)] px-2 text-[10px] text-[var(--ifm-font-color-base)] font-mono outline-none cursor-pointer focus:border-[var(--ifm-color-primary)]"
                        value={model}
                        onChange={onModelChange}
                        disabled={isLoading}
                    >
                        {modelOptions.map(({ id, label }) => (
                            <option key={id} value={id}>{label}</option>
                        ))}
                    </select>
                </label>
                <span>WARNING: AI 物理读写，请做好代码提交备份。</span>
            </div>
        </div>
    );
}
