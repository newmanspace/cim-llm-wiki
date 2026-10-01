# 7 维质量评分规范（Stage 3）

> 迁移自 `internal/pipeline/evaluator/evaluator.go`。权重为 POC 初始值，后续须用 Golden Dataset 校准。

## 总分公式

```
Total = w_auth·S_auth + w_comp·S_comp + w_rel·S_rel + w_fresh·S_fresh
      + w_struct·S_struct + w_reuse·S_reuse + w_risk·(1 − S_risk)
```

| 维度 | 权重 | 含义 |
|------|------|------|
| S_auth | 0.20 | 来源可信度 |
| S_comp | 0.20 | 内容完整性 |
| S_rel | 0.15 | 产品相关性 |
| S_fresh | 0.15 | 时效性 |
| S_struct | 0.10 | 结构质量 |
| S_reuse | 0.10 | 可复用性 |
| S_risk | 0.10 | 冲突风险（**反向计分**，贡献 = w·(1−S_risk)） |

结果截断到 [0,1]，保留 4 位小数。

## 各维度打分细则

### S_auth 来源可信度（按源文件类型）
- `.pdf / .docx / .pptx / .doc / .ppt / .xlsx`（正式设计文档）→ 1.0
- `.md / .txt` → 0.75
- 来源含 git/commit → 0.65
- 无来源 → 0.30；其他 → 0.50

### S_comp 完整性
必填字段：`id, type, title, content, domain, version, source`。每缺一项 −0.15，下限 0。

### S_rel 产品相关性
基础 0.5；有 module +0.20；有 version +0.15；有 domain +0.15；上限 1.0。
（内容含 Lot/Wafer/Chamber/Carrier/Track-in/Hold 等核心域关键词时可视情上浮，但须有依据。）

### S_fresh 时效性（按文档更新时间距今）
≤90 天 → 1.0；≤365 天 → 0.80；≤730 天 → 0.60；更久或未知 → 0.40。

### S_struct 结构质量
基础 0.4；含 1~3 级标题 +0.20；正文 >100 字符 +0.15；含代码块 +0.15；含 Markdown 表格 +0.10；上限 1.0。

### S_reuse 可复用性（按 related_* 关联总数）
≥4 → 1.0；3 → 0.85；2 → 0.70；1 → 0.55；0 → 0.40。

### S_risk 冲突风险
高危关键词（大小写不敏感）：`hold, release, qtime, state machine, 状态机, trackin, trackout, 卡批, 解挂, 进站, 出站, plm, erp, bom, route, 工艺路线`。
命中数 hits（title+content），另加：每个已标记冲突 +2。
hits ≥4 → 0.9；≥2 → 0.6；=1 → 0.3；0 → 0.1。

## 冲突检测

同批次内 ID 相同但 content 不同 → 两个节点互相标记 `conflict_with`，并计入 S_risk。
与 `data/wiki/` 既有页面同 ID 但内容实质不同 → 同样标记冲突，审核卡片中必须高亮为「高风险（冲突）」，由用户裁决保留旧版或覆盖。

## 审核等级门限

| Total | review_level | 处置 |
|-------|--------------|------|
| ≥ 0.95 | L0_auto | 免审自动编译入库（前提：无冲突、无既有规则修改） |
| ≥ 0.80 | L1_expert | 进入聚合审核卡片，领域专家确认 |
| ≥ 0.55 | L2_arch | 进入聚合审核卡片并标注需架构师裁决（涉及核心状态机/QTime/外部集成关键接口时强制 L2） |
| < 0.55 | archive | 归档到 data/review/archived/，不入主库 |

**强制升级规则**：即使得分达到 L0，若节点修改/冲突了既有 business_rule，或涉及 Hold/Release 状态机、QTime 约束、PLM/ERP 关键集成接口，一律升级为 L2_arch。
