# Fortuna synthetic demo data

This folder contains a deterministic, fully fictional portfolio for screenshots, product tours, and local testing.

- `fortuna-demo-data.json` is the human-readable source dataset.
- `Fortuna-Demo-Portfolio.xlsx` is an importable Fortuna backup.
- Every account, institution, identifier, balance, price, and transaction is synthetic. None of the files contain personal financial data.

To try it in Fortuna, open **Settings → Data Backup → Import Backup** and select `Fortuna-Demo-Portfolio.xlsx`. Import replaces the current on-device database, so export your own backup first if necessary.

Regenerate both files with:

```bash
npm run demo:generate
```
