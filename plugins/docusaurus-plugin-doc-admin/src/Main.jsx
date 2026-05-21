import React, { useMemo } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { usePluginData } from '@docusaurus/useGlobalData';
import AdminContent from './admin';
import { initOAuth2Client } from './admin/oauth2';

function AdminBootstrap() {
  const pluginOptions = usePluginData('docusaurus-plugin-doc-admin');

  useMemo(() => {
    if (pluginOptions) {
      initOAuth2Client(pluginOptions);
    }
  }, [pluginOptions]);

  if (!pluginOptions) {
    return <div>Loading...</div>;
  }

  return <AdminContent pluginOptions={pluginOptions} />;
}

export default function Main() {
  return (
    <BrowserOnly fallback={<div>Loading...</div>}>
      {() => <AdminBootstrap />}
    </BrowserOnly>
  );
}
