import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { usePluginData } from '@docusaurus/useGlobalData';
import ChatPanel from '../components/doc-agent/ui/ChatPanel.jsx';
import { initReadonlyClient } from '../components/doc-agent/tools/api';

function ChatPageContent() {
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
    <ChatPanel
      isOpen
      pluginOptions={pluginOptions}
      variant="page"
    />
  );
}

export default function ChatPage() {
  return (
    <BrowserOnly fallback={<div>Loading...</div>}>
      {() => <ChatPageContent />}
    </BrowserOnly>
  );
}
