import React from 'react';
import SmartScrollArea from './SmartScrollArea.jsx';

export default function CodeBody({ hasRealMessages, messagesAreaRef, welcome, children }) {
    return (
        <div className="flex-1 relative overflow-hidden">
            {!hasRealMessages && (
                <div className="absolute inset-0 flex items-center justify-center px-8 z-[1]">
                    {welcome}
                </div>
            )}
            <SmartScrollArea ref={messagesAreaRef} className="h-full overflow-y-auto p-6 flex flex-col gap-6 thin-scrollbar">
                {!hasRealMessages && <div className="flex-1" />}
                {children}
            </SmartScrollArea>
        </div>
    );
}
