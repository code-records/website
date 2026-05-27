import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { usePluginData } from '@docusaurus/useGlobalData';
import CodePanel from '../components/code-agent/ui/CodePanel.jsx';
import { initReadonlyClient } from '../components/doc-agent/tools/api';

function CodePageContent() {
  const pluginOptions = usePluginData('docusaurus-plugin-doc-agent');

  React.useMemo(() => {
    if (pluginOptions) {
      initReadonlyClient(pluginOptions);
    }
  }, [pluginOptions]);

  if (!pluginOptions) {
    return <div>Loading...</div>;
  }

  return (
    <CodePanel
      isOpen
      pluginOptions={pluginOptions}
      variant="page"
    />
  );
}

export default function CodePage() {
  return (
    <BrowserOnly fallback={<div>Loading...</div>}>
      {() => <CodePageContent />}
    </BrowserOnly>
  );
}
