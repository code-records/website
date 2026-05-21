
// const READONLY_BASE = '/agent-tools/api/v4';
// const projectID = '996';
// const ref = 'master';

// export async function readFileReadonly(path: string): Promise<string | null> {
//     const encoded = encodeURIComponent(path);
//     const url = `${READONLY_BASE}/projects/${projectID}/repository/files/${encoded}/raw?ref=${ref}`;
//     const res = await fetch(url);
//     if (res.ok) return res.text();
//     if (res.status === 404) return null;
//     throw new Error(`GitLab readonly read failed: ${res.status}`);
// }

// export async function readTreeReadonly(path = '', recursive = false): Promise<string[] | null> {
//     let allItems: Array<{ path: string }> = [];
//     let page = 1;
//     const perPage = 1000;

//     while (true) {
//         const params = new URLSearchParams({ ref, per_page: String(perPage), page: String(page) });
//         if (path) params.set('path', path);
//         if (recursive) params.set('recursive', 'true');

//         const url = `${READONLY_BASE}/projects/${projectID}/repository/tree?${params}`;
//         const res = await fetch(url);
//         if (!res.ok) {
//             if (res.status === 404) return null;
//             throw new Error(`GitLab readonly tree failed: ${res.status}`);
//         }

//         let items: Array<{ path: string }>;
//         try {
//             items = await res.json();
//         } catch (error) {
//             throw new Error(`GitLab readonly tree response parse failed: ${error instanceof Error ? error.message : String(error)}`);
//         }

//         if (!Array.isArray(items)) break;
//         allItems = [...allItems, ...items];
//         if (items.length < perPage) break;
//         page++;
//     }

//     return allItems.map(item => item.path);
// }
