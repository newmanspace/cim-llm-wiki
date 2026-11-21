# 可选评分与文档审核边界

文档 submit 的 qscore 可省略，未评分保持未知，不生成默认分数。submit、freeze、review 不以评分为前置。Agent 只在用户要求评分且具备实际证据时给出维度分数及理由。

## qscore 结构与总分

当前文档请求可携带 `{auth,comp,rel,fresh,struct,reuse,risk,total}`；七个维度必须是 [0,1] 有限数。服务端复算：

```text
Total = 0.20·auth + 0.20·comp + 0.15·rel + 0.15·fresh
      + 0.10·struct + 0.10·reuse + 0.10·(1 − risk)
```

total 保留四位小数，risk 越高表示风险越大。维度含义分别为来源可信度、完整性、相关性、时效性、结构、复用性及冲突风险。依据当前稿件、原稿版本和可定位证据评分，不能只按扩展名、关键词数量或示例分值给结论。

这套 qscore 与目录质量评估接口 document-evaluations 的维度不是同一请求模型，不能互相替换。仅在另有明确评估任务时读取实际接口和目录有效策略；不自行添加必填 evaluation。

## 审核边界

文档 `review` 是 POST /document-review-requests，使用 Agent 的 CIM_WIKI_TOKEN 申请人工审核，不发送批准决定、不使用人工审核凭据。决策由独立审核人在管理端完成。文档有新版或审核目标摘要变化时，旧批准不能静默复用。

修订提交新文档版本，保留真实来源关系及本地检查报告。
