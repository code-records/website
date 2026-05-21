# docusaurus-plugin-doc-admin

Online documentation editor migrated from `docs.dobest.cn/src-spa/admin`.

# api
gitee
https://gitee.com/api/v5/oauth_doc
https://gitee.com/api/v5/swagger
https://gitee.com/api/v5/doc_json

## Current State

This package owns its runtime dependencies and registers an `/admin` route. The document set list defaults to the Docusaurus `docs` directory and can be extended from plugin options.

## Docusaurus Config

```ts
plugins: [
  [
    require.resolve('./plugins/docusaurus-plugin-doc-admin'),
    {
      routePath: '/admin',
      gitee: {
        provider: 'gitee',
        owner: 'your-gitee-owner',
        repo: 'your-gitee-repo',
        ref: 'your-branch',
        clientId: 'your-gitee-oauth-client-id',
        clientSecret: 'your-gitee-oauth-client-secret',
      },
      docSets: {
        docs: {
          label: 'Docs',
          path: 'docs',
          sidebarPath: 'docs/_meta/sidebars.json',
          sidebarKey: 'sidebar',
        },
        h5: {
          label: 'H5 Docs',
          path: 'docs-h5',
          sidebarPath: 'docs-h5/_meta/sidebars.json',
          sidebarKey: 'sidebar',
        },
      },
    },
  ],
]
```

## Next Items

- Replace remaining GitLab-named component/file names with provider-neutral names.
- Replace the removed `_config/secrets.json` flow with a deployment-side config source.
