# Fortuna 双语纯模拟数据 / Bilingual synthetic demo data

本目录包含两套确定性的纯虚构资产组合，用于 GitHub 截图、产品演示和本地测试。所有账户、机构、标识符、余额、价格和交易均为模拟内容，不包含任何真实个人财务数据。

This folder contains two deterministic, fully fictional portfolios for GitHub screenshots, product tours, and local testing. Every account, institution, identifier, balance, price, and transaction is synthetic; no personal financial data is included.

## 中文演示

- `fortuna-demo-data.json`：可审阅的中文 JSON 数据源。
- `Fortuna-Demo-Portfolio.xlsx`：可直接导入 Fortuna 的中文完整备份。
- 导入路径：**设置 → 数据备份与恢复 → 恢复数据**。

## English demo

- `fortuna-demo-data.en.json`: reviewable English JSON source.
- `Fortuna-Demo-Portfolio.en.xlsx`: importable English Fortuna backup.
- Import from **Settings → Data Backup & Restore → Import Data**.

导入会替换当前设备数据库，请先导出自己的完整备份。Import replaces the current on-device database, so export your own complete backup first.

## Regenerate / 重新生成

```bash
npm run demo:generate
```

The generator writes both language variants from the same balances, dates, and isolated `demo-` identifiers, keeping Chinese and English screenshots directly comparable.
