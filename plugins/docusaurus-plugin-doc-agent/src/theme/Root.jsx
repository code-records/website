import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function Root({ children }) {
  return (
    <>
      {children}
      <BrowserOnly>
        {() => {
          const DocAgentWidget = require('../doc-agent').default;
          return <DocAgentWidget />;
        }}
      </BrowserOnly>
    </>
  );
}
