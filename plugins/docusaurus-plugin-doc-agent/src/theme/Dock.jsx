import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function DockRoot({ children }) {
  return (
    <>
      {children}
      <BrowserOnly>
        {() => {
          const Chat = require('../components/doc-agent/Chat.jsx').default;
          return <Chat />;
        }}
      </BrowserOnly>
    </>
  );
}
