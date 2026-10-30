# Fortuna 5.0.0 验证记录

发布：2026-10-30；版本5.0.0，Android versionCode 37，iOS build 37。

- 功能提交：`e3c8bfa34796c9e0d7d32d42f9547af79a4d4975`。
- [GitHub Release](https://github.com/charlotteamian/Fortuna/releases/tag/v5.0.0)正式签名APK已发布。
- 全量538项测试通过；ESLint、生产构建、两端Capacitor同步、iOS资源校验与diff检查通过。
- 隔离Chrome交互43项通过，页面错误0；320/390px、1×/1.3×字号无横向溢出。AI和行情运输为mock，不代表真实模型响应质量或真实交易行情。
- 巨潮公告与PDF请求为真实请求，东方财富输入使用归档fixture；真实PDF经pdfjs worker提取、解析为台账。平安银行最近两笔税前基数0.609元／股，两份PDF摘要与归档fixture一致，复查保持原核验日期。部分旧格式公告仍未能提取字段，界面具体标记缺口。
- [Android签名工作流](https://github.com/charlotteamian/Fortuna/actions/runs/40982354037)与[iOS Release编译](https://github.com/charlotteamian/Fortuna/actions/runs/40982350497)均成功。
- 下载的APK包名、5.0.0/37、非debug、长期签名指纹及GitHub SHA-256一致；48个当前前端资源与2个Capacitor桥接资源逐字节一致。
- 应用内更新解析：4.0.1提供5.0.0更新，5.0.0不重复提示；发行页与APK下载链接可用。
- 当前未连接ADB设备，未进行本版模拟器或真机安装、覆盖升级、数据保留验证；iOS结果为无签名Release编译，非可安装签名交付。

细节见本目录的本地、浏览器、公告、CI、签名和更新JSON记录。历史网格不自动替换，价格写入须预览确认，最新独立台账变化也会使旧草案失效。
