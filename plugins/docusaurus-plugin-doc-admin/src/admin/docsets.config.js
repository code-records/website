export const DEFAULT_DOCSETS = {
    docs: {
        label: 'Docs',
        path: 'docs',
        routeBasePath: 'docs',
        sidebarPath: 'docs/_meta/sidebars.json',
        sidebarKey: 'sidebar',
    },
};

function cleanGitPath(value) {
    return String(value || '').replace(/^\.?\//, '').replace(/\\/g, '/');
}

export function normalizeDocSets(docSets = DEFAULT_DOCSETS) {
    const entries = Array.isArray(docSets)
        ? docSets.map(docSet => [docSet.id || docSet.path, docSet])
        : Object.entries(docSets);

    const normalized = entries.reduce((result, [id, docSet]) => {
        if (!id || !docSet) return result;

        const pathValue = cleanGitPath(docSet.path || id);
        result[id] = {
            label: docSet.label || id,
            path: pathValue,
            routeBasePath: docSet.routeBasePath || pathValue,
            sidebarPath: cleanGitPath(docSet.sidebarPath || `${pathValue}/_meta/sidebars.json`),
            sidebarKey: docSet.sidebarKey || 'sidebar',
        };

        return result;
    }, {});

    return Object.keys(normalized).length > 0 ? normalized : DEFAULT_DOCSETS;
}
