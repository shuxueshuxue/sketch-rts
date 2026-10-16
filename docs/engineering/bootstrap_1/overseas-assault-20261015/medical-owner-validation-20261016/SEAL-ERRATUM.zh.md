封包时态勘误：master 内 INDEX 的 “Complete inventory only / No archive created / deferred” 和 FINAL-REPORT 的 prepared/sealingStatus 是封包前保留的历史记录，未改写已封字节。实际 master 已创建：91,144,570 bytes，SHA256 `c7fd569fb6a7935b55785b894ca3131da9bab85c0453497f1604a8920e09c98c`，1209 个 payload 文件加 INDEX 共 1210 个 regular entries，逐项解包读回 SHA256 验证通过。

实际状态以外部 `/tmp/bootstrap-medical-safe-owner-cf147743-20261016-seal-receipt.json` 为准。该勘误不改变原 source、raw、bundle 或 master 文件。
