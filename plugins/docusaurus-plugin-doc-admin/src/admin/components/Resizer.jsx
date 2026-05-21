import React, { useState, useCallback, useEffect, useRef } from 'react';

const Resizer = ({
    left,
    right,
    defaultRatio = 0.5,
    minRatio = 0.25,
    maxRatio = 0.8,
    storageKey = 'admin-editor-split-ratio',
    leftMinWidth = 0,
    rightMinWidth = 0
}) => {
    const containerRef = useRef(null);
    const [ratio, setRatio] = useState(() => {
        if (storageKey && typeof window !== 'undefined') {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                const parsed = parseFloat(saved);
                if (!isNaN(parsed) && parsed >= minRatio && parsed <= maxRatio) {
                    return parsed;
                }
            }
        }
        return defaultRatio;
    });
    const [isDragging, setIsDragging] = useState(false);

    const saveRatio = useCallback((newRatio) => {
        if (storageKey && typeof window !== 'undefined') {
            localStorage.setItem(storageKey, String(newRatio));
        }
    }, [storageKey]);

    const handleMouseDown = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleMouseMove = useCallback((e) => {
        if (!isDragging || !containerRef.current) return;

        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let newRatio = x / rect.width;

        newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));

        setRatio(newRatio);
    }, [isDragging, minRatio, maxRatio]);

    const handleMouseUp = useCallback(() => {
        if (isDragging) {
            setIsDragging(false);
            saveRatio(ratio);
        }
    }, [isDragging, ratio, saveRatio]);

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };
    }, [isDragging, handleMouseMove, handleMouseUp]);

    const handleDoubleClick = useCallback(() => {
        setRatio(defaultRatio);
        saveRatio(defaultRatio);
    }, [defaultRatio, saveRatio]);

    return (
        <div
            ref={containerRef}
            className={`flex w-full h-full overflow-hidden ${isDragging ? 'resizer-dragging' : ''}`}
        >
            <div
                className={`resizer-panel h-full overflow-hidden flex flex-col ${!isDragging ? 'transition-[width] duration-100 ease-out' : ''}`}
                style={{
                    width: `calc(${ratio * 100}% - 3px)`,
                    minWidth: leftMinWidth > 0 ? `${leftMinWidth}px` : undefined
                }}
            >
                {left}
            </div>

            <div
                className={`w-1.5 h-full bg-transparent cursor-col-resize relative shrink-0 z-10 transition-[background] duration-150 group ${isDragging ? 'bg-[var(--admin-primary-color)]' : 'hover:bg-[rgba(var(--admin-primary-rgb),0.3)]'}`}
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
                title="拖拽调整比例，双击重置"
            >
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 h-full transition-all duration-150 ${isDragging ? 'w-0.5 bg-[var(--admin-primary-color)]' : 'w-px bg-[#e0e0e0] group-hover:w-0.5 group-hover:bg-[var(--admin-primary-color)]'}`} />
            </div>

            <div
                className={`resizer-panel h-full overflow-hidden flex flex-col ${!isDragging ? 'transition-[width] duration-100 ease-out' : ''}`}
                style={{
                    width: `calc(${(1 - ratio) * 100}% - 3px)`,
                    minWidth: rightMinWidth > 0 ? `${rightMinWidth}px` : undefined
                }}
            >
                {right}
            </div>
        </div>
    );
};

export default Resizer;
