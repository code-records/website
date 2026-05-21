import axios from "axios";



/// ===============================================================================================================HTTP
/// 创建 axios 实例
const request = axios.create({
    baseURL: '',
    timeout: 6000, // 请求超时时间
    // headers: {'Authorization': 'Bearer '},
})
/// 异常拦截处理器
const errorHandler = (error) => {
    if (error.response) {
        // tips
        console.error(error.response)
    }
    return Promise.reject(error)
}
/// request 拦截器
request.interceptors.request.use(config => {
    const token = window.atob(window.atob('WjJsMGFIVmlYM0JoZEY4eE1VRkVTbGxQUzFrd1QycFdXV1k0V2twRE5FWTVYMFUzUnpWQ2VHWjJiRFl6ZDBkMWIyNTZOVWx5ZW1FM1VWaDNiR0ZhVmpVeFVEZHhjV1F4Ukc5b2F6TktNelZNUVRNMVNYTnJkbE5NTXpGTA=='))
    config.headers['Authorization'] = 'Bearer ' + token
    return config
}, errorHandler)
/// response 拦截器
request.interceptors.response.use((response) => {
    return response.status === 200 ? response.data : errorHandler({ response })
}, errorHandler)



/// ================================================================================================================API
/*
* 创建 GitHub Personal Access Token
* https://github.com/settings/tokens?type=beta
* 设置 Contents Issues 权限读写 默认包含 Metadata 权限读
*
* API
* https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2022-11-28#repository-permissions-for-contents
* 获取存储库内容 https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#get-repository-content
* */
const owner = 'wow-helper'; // ismanong wow-helper
const repo = 'wiki';        // data     wiki
const message = Date.now().toString();

// 用户详情
export function api_github_user() {
    const url = 'https://api.github.com/user';
    return request({
        url: url,
        method: 'get',
        params: {}
    })
}

// 获取内容
export function api_github_repo_contents_GET() {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/README.md`;
    return request({
        url: url,
        method: 'get',
    }).then(res => {
        res.content = contentDecode(res.content);
        return res;
    })
}

// 更新内容
export function api_github_repo_contents_UPDATA(content, sha) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/README.md`;
    return request({
        url: url,
        method: 'put',
        data: { "message": message, "content": window.btoa(content), sha: sha }// sha 需要更新文件的时候 必填
    })
}

// 创建内容
export function api_github_repo_contents_CREATE(content) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/README.md`;
    return request({
        url: url,
        method: 'put',
        data: { "message": message, "content": window.btoa(content) }// sha 需要更新文件的时候 必填
    })
}

// 获取存储库内容
export function api_github_repo_contents() {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents`;
    return request({
        url: url,
        method: 'get',
    }).then(res => {
        return dirAndFileSort(res, ['type', 'dir', 'file'], ['path']);
    })
}

// 获取目录树
export function api_github_git_trees(tree_sha) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${tree_sha}`;
    return request({
        url: url,
        method: 'get',
    }).then(res => {
        return dirAndFileSort(res.tree, ['type', 'tree', 'blob'], ['path']);
    })
}
// 获取文件内容
export function api_github_git_blobs(file_sha) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${file_sha}`;
    return request({
        url: url,
        method: 'get',
    }).then(res => {
        res.content = contentDecode(res.content);
        return res;
    })
}

/*
* 文件排序
* */
function dirAndFileSort(arr, [key, value, value2], [key2]) {
    arr.sort((a, b) => {
        // 比较 type 属性，文件夹排前面
        if (a[key] === value && b[key] === value2) {
            return -1; // a 排在前面
        } else if (a[key] === value2 && b[key] === value) {
            return 1; // b 排在前面
        } else {
            const aName = a.path;
            const bName = b.path;
            // 如果类型相同，则按名称排序，下划线排前面
            if (a[key2].startsWith('_') && !b[key2].startsWith('_')) {
                return -1; // a 排在前面
            } else if (!a[key2].startsWith('_') && b[key2].startsWith('_')) {
                return 1; // b 排在前面
            } else {
                // 如果都不以下划线开头，则按正常顺序排序
                return aName.localeCompare(bName);
            }
        }
    });
    return arr;
}
/*
* 文件内容解码
* */
function contentDecode(content) {
    // 中间层处理后返回给调用者
    //
    // 如果文件的内容是中文的话，base64解码后，注意使用utf在解码一次。
    //
    // 使用utf-8字符集解码base64字符串
    // 1. 原生js：escape(虽然该方法已经被不推荐使用，但还是有一些特殊用途的，尤其是对中文的编码)
    // escape 暂无替代函数 文档注明已废弃 浏览器可用 https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/escape
    // 2. npm package base64：...
    return decodeURIComponent(escape(window.atob(content)));
}


