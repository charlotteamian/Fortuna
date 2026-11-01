# Excel 折叠偏好兼容项

2026-11-01，基线 db29094。本项只修复既有 `settings.dividendHomeCollapsedCodes` 的 Excel JSON 序列化与还原，并校验其为字符串数组。保持字段缺失与显式空数组的区别，不新增字段、数据库版本、工作表或备份版本；备份版本仍为6。

独立验证：`node --test --test-name-pattern='Excel.*collapse' scripts/excelBackup.test.ts`，4/4通过。覆盖未设置、全部展开的空数组、股票折叠与基金展开标记的混合数组，以及损坏JSON/非数组/非字符串成员拒绝导入且所有表不变。记录见 [excel-preference-test.log](excel-preference-test.log)。原Excel完整回归也继续在750项全量测试内运行。

仅在隔离测试库中往返。未导入、导出或操作真实用户账本。基金的 `open:fund:<id>` 标记保存在同一个既有阅读偏好数组中，与基金计划、持仓和预算分离；股票的原六位代码语义保留。
