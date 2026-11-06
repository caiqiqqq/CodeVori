/** 用户可见品牌；包名和协议 ID 不跟随显示名变更。 */
export const PRODUCT_NAME = "CodeVori";
/** 应用偏好按软件名称隔离，避免上游客户端保存时过滤本产品新增字段。 */
export const PRODUCT_SETTINGS_DIRECTORY_NAME = `.${PRODUCT_NAME.toLowerCase()}`;
/** 产品仓库首页，同时作为桌面“更新日志”的固定入口。 */
export const PRODUCT_REPOSITORY_URL = "https://github.com/caiqiqqq/CodeVori";
/** 通用问题上报入口固定归属本产品，不随上游远端帮助配置切换。 */
export const PRODUCT_ISSUES_URL = `${PRODUCT_REPOSITORY_URL}/issues`;
/** 产品 V 字形的唯一矢量源；UI、启动壳和各平台图标从此派生。 */
export const PRODUCT_MARK_VIEW_BOX = "0 0 256 218";
export const PRODUCT_MARK_PATH = "M0 8H56L128 158L200 8H256L158 210H98Z";
