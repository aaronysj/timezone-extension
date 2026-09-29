# Chrome Web Store listing — 0.2.0

## English description

Timezone Override lets you choose the timezone websites see, either for all sites or for selected domains. Your device's timezone stays unchanged.

• All sites: use one selected timezone across supported web pages.
• By rules: assign different timezones to different domains, with optional subdomain matching.
• Exclusions: keep selected sites on your device's timezone. Exclusions take priority.
• Off: return to your device's timezone.
• Search timezones by city, IANA timezone ID, or UTC offset.
• Check the current tab's applied timezone and local time from the toolbar popup.
• Preview which rule matches a URL in Settings before saving your changes.
• Interface available in English, Simplified Chinese, Japanese, and Korean.

Uses bundled page scripts to change Date and default Intl timezone behavior before website scripts run. No debugger permission or Chrome debugging banner is required. Each iframe follows the rule for its own URL. Workers and previously cached native APIs or already-created Intl formatters keep their original timezone; reload existing pages for consistent results. This is page API emulation, not browser-wide native timezone emulation.

No account, analytics, or external service is required. Settings and domain rules are stored locally. Page URLs are processed locally to match your rules and are not sent to the developer or third parties.

Requires Chrome 125 or newer. Chrome internal pages and other restricted pages are not supported. This changes the timezone exposed to supported pages; it does not change your IP address, location, or operating system timezone. Existing pages are updated without an automatic reload.

## 简体中文描述

Timezone Override 可为所有网站统一设置时区，也可按域名分别设置时区，设备自身的时区保持不变。

• 全部网站：让支持的网页使用同一个指定时区。
• 按规则：为不同域名设置不同的时区，可选择是否包含子域名。
• 排除规则：让指定网站继续使用设备时区，排除规则优先。
• 关闭：恢复使用设备时区。
• 支持按城市、IANA 时区标识和 UTC 偏移搜索时区。
• 在工具栏弹窗中查看当前标签页实际应用的时区与当地时间。
• 在设置页输入网址，预览匹配的规则，再保存并应用修改。
• 支持 English、简体中文、日本語和 한국어 界面。

通过随扩展打包的网页脚本，在网站脚本执行前修改 Date 和默认 Intl 时区行为，无需 debugger 权限，不会出现 Chrome 调试提示。iframe 按自身网址匹配规则。Worker、已缓存的原生 API 和已有 Intl 格式化器仍使用原时区；已打开的网页建议刷新后使用。这是网页 API 模拟，并非浏览器级原生时区覆盖。

无需账号、分析服务或外部服务。设置和域名规则保存在本机。网页网址仅在本机用于匹配规则，不会发送给开发者或第三方。

需要 Chrome 125 或更新版本，不支持 Chrome 内部页面及其他受限制页面。扩展修改支持网页所感知的时区，不修改 IP 地址、地理位置或操作系统时区。已打开的网页会即时更新，扩展不会自动刷新页面。

## Listing fields

- Name: Timezone Override (localized names come from the package).
- Category: choose the available category that best matches a browser development/testing utility.
- Primary language: English; add the Simplified Chinese description above as a localization.
- Price: Free.
- Visibility: Public.
- Regions: All available regions.
- Publish automatically after review: Yes.
- Homepage/support URL: not configured; do not invent URLs.
- Privacy policy URL: https://gist.github.com/aaronysj/7842872d1a6cc001f566d272c6cba235

## Reviewer instructions

No account is needed. Chrome 125+ required. Open https://example.com, select All sites and Asia/Tokyo. Reload; in DevTools verify Intl.DateTimeFormat().resolvedOptions().timeZone is Asia/Tokyo and new Date().getTimezoneOffset() is -540. No debugging banner should appear. Add an example.com rule with America/New_York; save, then verify. Exclude example.com, or select Off, to restore system time. Each frame follows its own URL. Workers retain system time.

All executable code is bundled. Persistent MAIN-world document_start scripts override page Date and default Intl APIs. No debugger API, network interception, analytics, remote code, or automatic page reload is used. Existing Intl instances and cached native APIs may keep their original behavior until the page is refreshed.
