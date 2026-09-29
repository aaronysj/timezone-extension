# Chrome Web Store release 0.2.0

## 当前状态

0.2.0 已于 2026-09-29（America/Los_Angeles）成功提交 Chrome Web Store 审核，当前状态为“待审核”，已勾选审核通过后自动发布；尚未上架。用户完成代码 review 后授权继续发布，0.1.0 的审核已撤回。

已保存新版英文与简体中文说明、单一用途、scripting/storage/tabs/webNavigation/网站访问权限理由、无远程代码和无收集数据声明，以及 457 字符审核测试步骤。已核对免费、公开、所有地区分发；商店软件包显示版本 0.2.0，权限列表没有 debugger。Google 提示所有网站权限可能触发深入审核并延迟发布时间；该权限用于全局覆盖与用户自定义域名规则。

送审成功提示与开发者后台的 0.2.0“待审核”状态已确认。本地截图：`submitted-for-review-0.2.0.png`（截图由 `.gitignore` 排除）。

- 发布者：`aaronysj.top`（`55b29df0-6494-4bf6-b7ed-96c8f4c8d448`）。
- 扩展 ID：`hecgaoajefgkcnmmmolmofcfioknelog`。
- 后台：https://chrome.google.com/webstore/devconsole/55b29df0-6494-4bf6-b7ed-96c8f4c8d448/hecgaoajefgkcnmmmolmofcfioknelog/edit
- 用户已授权公开联系邮箱 `hfutjsj.ysj@gmail.com`，邮箱验证已完成。
- 隐私政策公开 Gist 已更新为 0.2.0，并读取确认：https://gist.github.com/aaronysj/7842872d1a6cc001f566d272c6cba235 。

## 本次变更与验证

- 使用持久注册的 MAIN-world `document_start` 脚本修改网页 Date 和默认 Intl 时区，移除 debugger 权限与自动刷新。
- iframe 按自身网址匹配；Worker 保持系统时区，已缓存的原生 API 和已有 Intl 实例可能保留原行为。设置页和发布说明已写明这些限制。
- `npm test`：8 个测试文件，144 项通过，包含六个时区与原生 Date 的对照、DST 重复/缺失时间、日期解析和关闭恢复。
- `npm run build`：i18n（4 locales、208 messages）、TypeScript、生产构建通过。
- 真实 Chromium E2E：14 项检查通过，包括无 debugger 权限、全部浏览器支持时区文件、严格 CSP、跨域/继承来源 iframe、规则优先级和实时关闭恢复。
- ZIP 根目录 manifest、完整性及无 sourcemap 已验证。

## 0.2.0 文件

- 本地上传包：`timezone-override-0.2.0.zip`，311695 bytes（ZIP 由 `.gitignore` 排除）。
- SHA-256：`b6190883b2e23002f0eda6b074eb82997e9a3d9bd61cf72ae15904b5202210ef`。
- 新版商店说明和测试步骤：`listing.md`；权限理由：`privacy.json`。
- 隐私政策：`timezone-override-privacy-policy.md`、`privacy-policy.html`。
- 商店图标、规则截图和宣传图：`assets/`。

## 0.1.0 发布记录（已撤回审核）

已使用用户 Chrome 上传 `timezone-override-0.1.0.zip`，并成功提交审核。当时状态为“待审核”，勾选审核通过后自动发布；该审核已于新版发布准备期间撤回。提交日期：2026-09-28（America/Los_Angeles）。

- 发布者：`aaronysj.top`（`55b29df0-6494-4bf6-b7ed-96c8f4c8d448`）。
- 扩展 ID：`hecgaoajefgkcnmmmolmofcfioknelog`。
- 后台：https://chrome.google.com/webstore/devconsole/55b29df0-6494-4bf6-b7ed-96c8f4c8d448/hecgaoajefgkcnmmmolmofcfioknelog/edit
- 已保存：英文、简体中文介绍；开发者工具类别；商店图标；一张全球通用规则截图；小型宣传图；单一用途；四项权限说明；无远程代码；无收集数据及三项用途声明；465 字符审核测试说明。
- 已核对分发：免费、公开、所有地区。
- 联系邮箱已完成验证，后台显示“已将您的扩展程序提交送审”，关闭成功提示后显示“待审核”。
- 提交成功证据：`submitted-for-review.png`。
- 用户已明确授权公开联系邮箱 `hfutjsj.ysj@gmail.com`，验证已完成。

用户已授权将隐私政策发布到 GitHub 公开 Gist，已发布并保存到商店隐私政策 URL 字段：https://gist.github.com/aaronysj/7842872d1a6cc001f566d272c6cba235 。

### 历史文件

- 上传包：`timezone-override-0.1.0.zip`，217059 bytes。
- SHA-256：`ea3c1e0c4226d5a5d30a8d0cad161a66bfb0514c9b4c07b6dabe18a4fcb5d82e`。
- 商店描述、分发建议和审核测试说明：`listing.md`。
- 单一用途、权限理由、远程代码和数据声明：`privacy.json`。
- 待部署的隐私政策：`privacy-policy.html`。
- 商店图标：`assets/icon-128.png`，128×128，透明留白。
- 小宣传图：`assets/small-promo-440x280.png`，440×280。
- 英文界面截图：`assets/screenshot-rules-1280x800.png`、`assets/screenshot-picker-1280x800.png`，均为1280×800。

截图直接拍摄当前生产构建的 Settings 页面。临时本地预览提供与测试相同的 Chrome storage/i18n API 替身及虚构 example.com 等域名规则；未修改产品页面或真实用户设置，截图没有声明任何模拟的 debugger 成功状态。截图仅展示设置界面；原生覆盖行为通过真实 Chromium E2E 单独验证。

上传 ZIP 根目录包含 manifest.json，仅打包 dist 的运行资源，无源码、测试、node_modules、开发资料或 sourcemap。

### 历史验证

- `npm test`：6 个文件，136 项测试通过。
- `npm run build`：i18n（4 locales、213 messages）、TypeScript、Vite 生产构建通过。
- Chromium 140 E2E：9 个场景全部通过，包含全局覆盖、规则匹配/不匹配、域名导航、排除规则优先、即时修改、关闭恢复，以及 iframe / dedicated worker 的时区继承。
- ZIP 完整性及根目录 manifest 已验证；PNG 尺寸已验证。

## 后续

等待 Google 审核。审核通过后自动发布；若收到拒绝或补充资料通知，按实际审核意见处理。审核通过前不能声称已经上架。
