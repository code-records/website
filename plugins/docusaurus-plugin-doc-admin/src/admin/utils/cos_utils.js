// 腾讯云 COS 上传工具库
/**
 * 敏感配置存储方案说明：
 * 
 * 方案 1：仓库文件加密（当前采用）
 * - 做法：将配置存放在 GitLab 仓库的 admin/.config/secrets.json 中。
 * - 优点：简单直接，利用现有文件 API 即可读取，适合内网或私有仓库。
 * - 风险：对仓库有代码读取权限的人即可查看到文件内容。
 * 
 * 方案 2：GitLab Snippets（推荐 - 物理隔离）
 * - 做法：在 GitLab 创建一个 Private Snippets，通过 Snippets API 分独读取。
 * - 优点：配置不存放在主项目代码树中，实现了配置与代码的物理隔离。
 * - 场景：适合不想让所有参与开发的人都看到密钥的情况。
 * 
 * 方案 3：GitLab Project Variables（最高级 - 动态注入）
 * - 做法：将密钥存放在 GitLab CI/CD Settings -> Variables 中。
 * - 优点：最符合 DevOps 规范，密钥不会出现在任何文件里。
 * - 限制：前端通过 OAuth Token 读取 Variables 权限要求较高（通常需 Maintainer 权限）。
 */
import COS from 'cos-js-sdk-v5';

// COS 配置缓存
let cosInstance = null;
let cosConfig = null;

/**
 * 动态初始化 COS 配置
 * @param {Object} config 从 GitLab 加载出来的配置对象
 */
export const initCOS = (config) => {
    if (!config) return;

    cosConfig = {
        SecretId: config.secret_id,
        SecretKey: config.secret_key,
        Bucket: config.bucket,
        Region: config.region,
        BaseUrl: config.bucket_url
    };

    cosInstance = new COS({
        SecretId: cosConfig.SecretId,
        SecretKey: cosConfig.SecretKey,
    });

    console.log('[COS] 模块初始化成功');
};

/**
 * 获取上传路径
 * @returns {string} 目录路径，以 / 结尾
 */
const getUploadDir = () => {
    const isProd = window.location.hostname === 'docs.dobest.cn';
    return isProd ? 'prod/' : 'docs/test/';
};

/**
 * 上传图片到腾讯云 COS
 * @param {File} file 文件对象
 * @returns {Promise<string>} 图片访问链接
 */
export const uploadToCOS = (file) => {
    return new Promise((resolve, reject) => {
        if (!cosInstance || !cosConfig) {
            reject(new Error('COS 未初始化，请确保已登录并加载配置'));
            return;
        }

        const dir = getUploadDir();
        const ext = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
        const key = `${dir}${fileName}`;

        cosInstance.putObject({
            Bucket: cosConfig.Bucket,
            Region: cosConfig.Region,
            Key: key,
            Body: file,
        }, (err, data) => {
            if (err) {
                console.error('COS Upload Error:', err);
                reject(err);
            } else {
                const url = `${cosConfig.BaseUrl}/${key}`;
                resolve(url);
            }
        });
    });
};
