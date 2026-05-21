import React, { useState, useEffect } from 'react';

const FrontmatterPanel = ({ frontmatter, onChange }) => {
    const [position, setPosition] = useState('');

    useEffect(() => {
        const pos = frontmatter?.sidebar_position;
        setPosition(pos !== undefined && pos !== null ? String(pos) : '');
    }, [frontmatter]);

    const handlePositionChange = (e) => {
        const value = e.target.value;
        setPosition(value);
        const newFrontmatter = { ...frontmatter };
        if (value === '' || value === null) {
            delete newFrontmatter.sidebar_position;
        } else {
            newFrontmatter.sidebar_position = Number(value);
        }
        onChange(newFrontmatter);
    };

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f9fafb] border-b border-[#e5e7eb] text-[13px]">
            <span className="text-sm">📋</span>
            <span className="text-[#6b7280] font-medium">排序</span>
            <input
                type="number"
                className="w-[60px] px-2 py-1 border border-[#d1d5db] rounded text-[13px] text-center outline-none transition-[border-color] duration-150 focus:border-[#3b82f6] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)] no-spinner"
                value={position}
                placeholder="—"
                min="0"
                onChange={handlePositionChange}
            />
        </div>
    );
};

export default FrontmatterPanel;
