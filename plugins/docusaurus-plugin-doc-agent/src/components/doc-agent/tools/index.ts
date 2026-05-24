import browseTree from './BrowseTreeTool';
import readDoc from './ReadDocTool';
import searchDocs from './SearchDocsTool';
import type { Tool } from '../../../agent/tools';

// A2UI is temporarily disabled. Keep the tool implementation in ./a2ui.ts for
// later re-enable, but do not import/register it while disabled.
// import a2ui from './a2ui';

export const DOC_AGENT_TOOLS: Tool[] = [
    searchDocs,
    readDoc,
    browseTree,
    // a2ui,
];
